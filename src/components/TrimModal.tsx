import { useState, useEffect, useRef, useCallback } from "react";
import { SquareSplitHorizontal, MousePointer, Scissors } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Modal, ModalHeader, ModalTitle } from "./ui/modal";
import { Button, ButtonGroup } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { TrimBar } from "./TrimBar";
import { TrimSidebar } from "./TrimSidebar";
import { PlaybackControls } from "./PlaybackControls";
import { formatDuration } from "@/lib/utils";
import { useExport } from "@/contexts/ExportContext";
import { useFrameCache } from "@/hooks/useFrameCache";
import { useTrimPersistence } from "@/hooks/useTrimPersistence";
import { useVideoPlayback } from "@/hooks/useVideoPlayback";
import { useTrimManager, TRIM_COLORS } from "@/hooks/useTrimManager";
import { useMarkerManager } from "@/hooks/useMarkerManager";
import { useTrimKeyboardShortcuts } from "@/hooks/useTrimKeyboardShortcuts";

interface TrimModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  fileName: string;
  fileSize: number;
  onCancel: () => void;
  onExportStarted?: () => void;
}

type BarMode = 'select' | 'trim' | 'marker';

export function TrimModal({
  open,
  onOpenChange,
  filePath,
  fileName,
  fileSize,
  onCancel,
  onExportStarted,
}: TrimModalProps) {
  const { openPanel, isExporting } = useExport();
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingCaptureRef = useRef<number | null>(null);
  const frameCacheRef = useRef<Map<number, string>>(new Map());

  // UI state
  const [duration, setDuration] = useState(0);
  const [filmstrip, setFilmstrip] = useState<string[]>([]);
  const [cachedFrame, setCachedFrame] = useState<string | null>(null);
  const [trimsVisible, setTrimsVisible] = useState(true);
  const [markersVisible, setMarkersVisible] = useState(true);
  const [barMode, setBarMode] = useState<BarMode>('select');
  const [pendingTrimStart, setPendingTrimStart] = useState<number | null>(null);
  const [pendingTrimEnd, setPendingTrimEnd] = useState<number | null>(null);
  const [loopZone, setLoopZone] = useState<{ start: number; end: number } | null>(null);
  const [playheadLocked, setPlayheadLocked] = useState(false);
  const [showRemaining, setShowRemaining] = useState(false);

  const isValid = true;
  const videoSrc = convertFileSrc(filePath);

  // Frame cache hook
  const frameCache = useFrameCache({
    filePath,
    duration,
  });

  // Keep local ref in sync with hook's cache for playback loop
  useEffect(() => {
    frameCacheRef.current = new Map();
  }, [filePath]);

  // Persistence hook
  const persistence = useTrimPersistence({
    filePath,
    enabled: open,
  });

  // Video playback hook
  const playback = useVideoPlayback({
    videoRef,
    duration,
    loopZone,
    trims: persistence.trims,
    onFrameCapture: frameCache.captureFrame,
    getCacheKey: frameCache.getCacheKey,
    frameCacheRef,
  });

  // Clear loop zone callback
  const clearLoopZone = useCallback(() => setLoopZone(null), []);

  // Trim manager hook
  const trimManager = useTrimManager({
    trims: persistence.trims,
    setTrims: persistence.setTrims,
    nextTrimId: persistence.nextTrimId,
    setNextTrimId: persistence.setNextTrimId,
    duration,
    currentTime: playback.currentTime,
    loopZone,
    onLoopZoneClear: clearLoopZone,
    filePath,
  });

  // Marker manager hook
  const markerManager = useMarkerManager({
    markers: persistence.markers,
    setMarkers: persistence.setMarkers,
    nextMarkerId: persistence.nextMarkerId,
    setNextMarkerId: persistence.setNextMarkerId,
    duration,
    currentTime: playback.currentTime,
    loopZone,
    onLoopZoneClear: clearLoopZone,
  });

  // Keyboard shortcuts hook
  useTrimKeyboardShortcuts({
    enabled: open,
    togglePlay: playback.togglePlay,
    stepFrame: playback.stepFrame,
    goToStart: playback.goToStart,
    setBarMode,
    clearPendingTrim: () => {
      setPendingTrimStart(null);
      setPendingTrimEnd(null);
    },
    clearLoopZone,
    toggleTrimsVisible: () => setTrimsVisible(prev => !prev),
    pendingTrimStart,
    loopZone,
  });

  // Extract stable references from hooks to avoid infinite re-render loops
  // (hook return objects are new references every render)
  const clearFrameCache = frameCache.clearCache;
  const prefetchAroundTime = frameCache.prefetchAround;
  const setPlaybackTime = playback.setCurrentTime;

  // Load filmstrip when modal opens
  useEffect(() => {
    if (!open) return;

    // Reset UI state
    setFilmstrip([]);
    setDuration(0);
    setTrimsVisible(true);
    setMarkersVisible(true);
    setBarMode('select');
    setPendingTrimStart(null);
    setPendingTrimEnd(null);
    setLoopZone(null);
    setPlayheadLocked(false);
    setCachedFrame(null);
    clearFrameCache();

    const loadFilmstrip = async () => {
      try {
        const dur = await invoke<number>("get_video_duration", { path: filePath });
        setDuration(dur);

        const frames = await invoke<string[]>("extract_filmstrip", {
          path: filePath,
          duration: dur,
          count: 10,
        });
        setFilmstrip(frames);
      } catch (e) {
        console.error("Failed to load filmstrip:", e);
      }
    };

    loadFilmstrip();
  }, [open, filePath, clearFrameCache]);

  // Reset playback state when modal opens
  useEffect(() => {
    if (!open) return;

    setPlaybackTime(0);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  }, [open, setPlaybackTime]);

  // Auto-prefetch when paused
  useEffect(() => {
    if (playback.isPlaying || !open || persistence.loading || duration === 0) return;

    const timeout = setTimeout(() => {
      prefetchAroundTime(playback.currentTime, 100, 50);
    }, 500);

    return () => clearTimeout(timeout);
  }, [playback.isPlaying, playback.currentTime, open, persistence.loading, duration, prefetchAroundTime]);

  // Deselect marker when playhead moves away from it
  useEffect(() => {
    if (markerManager.selectedMarkerId === null) return;

    const selectedMarker = persistence.markers.find(m => m.id === markerManager.selectedMarkerId);
    if (!selectedMarker) return;

    // Threshold: if playhead is more than 0.5s away, deselect
    const threshold = 0.5;
    if (Math.abs(playback.currentTime - selectedMarker.time) > threshold) {
      markerManager.setSelectedMarkerId(null);
    }
  }, [playback.currentTime, markerManager.selectedMarkerId, persistence.markers, markerManager]);

  // Handle video metadata loaded
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video && duration === 0) {
      setDuration(video.duration);
    }
  };

  // Handle video time updates
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    playback.setCurrentTime(video.currentTime);
  }, [playback]);

  // Handle hover on trim bar
  const handleHover = (time: number | null) => {
    if (time === null) {
      pendingCaptureRef.current = null;
      return;
    }

    if (playback.isPlaying) return;
    if (barMode === 'select' && playheadLocked) return;

    const video = videoRef.current;
    if (!video) return;

    playback.setCurrentTime(time);
    playback.prevTimeRef.current = time;

    const cached = frameCache.getCachedFrame(time);

    if (cached) {
      setCachedFrame(cached);
    } else {
      setCachedFrame(null);
      pendingCaptureRef.current = time;
      video.currentTime = time;
    }
  };

  // Capture frames after video seeks
  const handleSeeked = useCallback(() => {
    if (playback.isPlaying) return;

    if (pendingCaptureRef.current !== null) {
      frameCache.captureFrame(pendingCaptureRef.current);
      pendingCaptureRef.current = null;
    }
  }, [playback.isPlaying, frameCache]);

  // Seek to a specific time
  const handleSeek = (time: number) => {
    playback.seekTo(time);
  };

  // Handle trim update from TrimBar
  const handleTrimUpdate = useCallback((id: number, start: number, end: number) => {
    trimManager.updateTrim(id, start, end, playback.seekTo);
  }, [trimManager, playback]);

  // Volume change handler
  const handleVolumeChange = useCallback((newVolume: number) => {
    playback.setVolume(newVolume);
    if (newVolume > 0 && playback.isMuted) playback.setIsMuted(false);
    if (newVolume === 0) playback.setIsMuted(true);
  }, [playback]);

  // Open universal export panel
  const handleContinue = () => {
    if (videoRef.current) {
      videoRef.current.pause();
    }

    const ranges = persistence.trims.length > 0
      ? persistence.trims.map(t => ({ startTime: t.startTime, endTime: t.endTime }))
      : [{ startTime: 0, endTime: duration }];

    const totalDuration = ranges.reduce((sum, r) => sum + (r.endTime - r.startTime), 0);

    openPanel({
      id: crypto.randomUUID(),
      sourcePath: filePath,
      sourceName: fileName,
      sourceSize: fileSize,
      ranges,
      duration: totalDuration,
      markers: persistence.markers,
    });

    onExportStarted?.();
  };

  const handleCancel = () => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
    onCancel();
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} fullScreen>
      <TooltipProvider delayDuration={300}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b">
            <ModalHeader onClose={handleCancel}>
              <ModalTitle>Trim Video</ModalTitle>
            </ModalHeader>
          </div>

          {/* Video Preview + Sidebar */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {/* Video area */}
            <div className="flex-1 bg-black flex items-center justify-center overflow-hidden relative">
              <div className="relative max-w-full max-h-full">
                <video
                  ref={videoRef}
                  src={videoSrc}
                  crossOrigin="anonymous"
                  className="max-w-full max-h-full object-contain block"
                  playsInline
                  muted={playback.isMuted}
                  preload="metadata"
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onSeeked={handleSeeked}
                  onEnded={() => {
                    if (videoRef.current) {
                      videoRef.current.currentTime = 0;
                      playback.prevTimeRef.current = 0;
                      videoRef.current.play().catch(() => {});
                    }
                  }}
                />

                {/* Cached frame overlay */}
                {cachedFrame && (
                  <img
                    src={cachedFrame}
                    alt=""
                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  />
                )}
              </div>

              {/* Play/Pause button overlay */}
              <button
                onClick={playback.togglePlay}
                className="absolute inset-0 flex items-center justify-center group"
              >
                <div className="w-20 h-20 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {playback.isPlaying ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16" className="text-white" fill="currentColor">
                      <path d="M5,1H2C1.4,1,1,1.4,1,2v12c0,0.6,0.4,1,1,1h3c0.6,0,1-0.4,1-1V2C6,1.4,5.6,1,5,1z"/>
                      <path d="M14,1h-3c-0.6,0-1,0.4-1,1v12c0,0.6,0.4,1,1,1h3c0.6,0,1-0.4,1-1V2C15,1.4,14.6,1,14,1z"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16" className="text-white ml-1" fill="currentColor">
                      <path d="M14,7.999c0-0.326-0.159-0.632-0.427-0.819l-10-7C3.269-0.034,2.869-0.058,2.538,0.112 C2.207,0.285,2,0.626,2,0.999v14.001c0,0.373,0.207,0.715,0.538,0.887c0.331,0.17,0.73,0.146,1.035-0.068l10-7 C13.841,8.633,14,8.327,14,8.001C14,8,14,8,14,7.999C14,8,14,8,14,7.999z"/>
                    </svg>
                  )}
                </div>
              </button>
            </div>

            {/* Sidebar */}
            <TrimSidebar
              trims={persistence.trims}
              markers={persistence.markers}
              duration={duration}
              loading={persistence.loading}
              selectedMarkerId={markerManager.selectedMarkerId}
              trimsVisible={trimsVisible}
              markersVisible={markersVisible}
              isDetectingScenes={trimManager.isDetectingScenes}
              onAddTrim={trimManager.addTrim}
              onAddMarker={markerManager.addMarkerAtPlayhead}
              onDeleteTrim={trimManager.deleteTrim}
              onDeleteMarker={markerManager.deleteMarker}
              onUpdateTrimName={trimManager.updateTrimName}
              onUpdateMarkerName={markerManager.updateMarkerName}
              onSeek={handleSeek}
              onSelectMarker={markerManager.setSelectedMarkerId}
              onToggleTrimsVisible={() => setTrimsVisible(prev => !prev)}
              onToggleMarkersVisible={() => setMarkersVisible(prev => !prev)}
              onClearAllTrims={() => persistence.setTrims([])}
              onClearAllMarkers={() => {
                persistence.setMarkers([]);
                markerManager.setSelectedMarkerId(null);
              }}
              onQuickDuration={trimManager.addTrimWithDuration}
              onAutoDetect={trimManager.detectScenes}
            />
          </div>

          {/* Controls */}
          <div className="p-4 border-t space-y-4">
            {/* Time display */}
            <div className="flex items-center justify-between text-sm">
              {/* Mode selector */}
              <div className="flex items-center gap-4">
                <ButtonGroup>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="subtle"
                        size="sm"
                        onClick={() => { setBarMode('select'); setLoopZone(null); setPendingTrimStart(null); setPendingTrimEnd(null); }}
                        className={barMode === 'select' ? 'bg-blue-500/20 text-blue-400' : ''}
                      >
                        <MousePointer className="h-4 w-4 mr-1" />
                        Select
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>Click/drag to select <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">1</kbd> <kbd className="px-1 py-0.5 bg-zinc-700 rounded text-[10px]">S</kbd></p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="subtle"
                        size="sm"
                        onClick={() => { setBarMode('trim'); setLoopZone(null); setPendingTrimStart(null); setPendingTrimEnd(null); }}
                        className={barMode === 'trim' ? 'bg-yellow-500/20 text-yellow-400' : ''}
                      >
                        <Scissors className="h-4 w-4 mr-1" />
                        Trim
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>Click/drag to create trims <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">2</kbd> <kbd className="px-1 py-0.5 bg-zinc-700 rounded text-[10px]">T</kbd></p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="subtle"
                        size="sm"
                        onClick={() => { setBarMode('marker'); setLoopZone(null); setPendingTrimStart(null); setPendingTrimEnd(null); }}
                        className={barMode === 'marker' ? 'bg-red-500/20 text-red-400' : ''}
                      >
                        <SquareSplitHorizontal className="h-4 w-4 mr-1" />
                        Marker
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p>Click to add markers <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">3</kbd> <kbd className="px-1 py-0.5 bg-zinc-700 rounded text-[10px]">M</kbd></p>
                    </TooltipContent>
                  </Tooltip>
                </ButtonGroup>
              </div>

              {/* Playhead / Total duration */}
              <button
                onClick={() => setShowRemaining(!showRemaining)}
                className="flex items-center gap-2 hover:bg-muted/50 px-2 py-1 -my-1 rounded transition-colors"
              >
                <span className="text-foreground tabular-nums">
                  {showRemaining ? `-${formatDuration(duration - playback.currentTime)}` : formatDuration(playback.currentTime)}
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="text-muted-foreground tabular-nums">{formatDuration(duration)}</span>
              </button>
            </div>

            {/* Trim bar */}
            {duration > 0 ? (
              <TrimBar
                duration={duration}
                trims={persistence.trims}
                trimsVisible={trimsVisible}
                markersVisible={markersVisible}
                onTrimUpdate={handleTrimUpdate}
                onHover={handleHover}
                markers={persistence.markers}
                selectedMarkerId={markerManager.selectedMarkerId}
                filmstrip={filmstrip}
                currentTime={playback.currentTime}
                colors={TRIM_COLORS}
                mode={barMode}
                pendingTrimStart={pendingTrimStart}
                pendingTrimEnd={pendingTrimEnd}
                onSeek={handleSeek}
                onTrimCreate={trimManager.createTrim}
                onMarkerAdd={markerManager.addMarker}
                onPendingTrimChange={setPendingTrimStart}
                onPendingTrimEndChange={setPendingTrimEnd}
                loopZone={loopZone}
                onLoopZoneChange={setLoopZone}
                playheadLocked={playheadLocked}
                onPlayheadLockChange={setPlayheadLocked}
                cachedTimes={frameCache.cachedTimes}
              />
            ) : (
              <div className="h-16 bg-muted rounded-lg flex items-center justify-center text-sm text-muted-foreground">
                {persistence.loading ? "Loading..." : "Could not load video"}
              </div>
            )}

            {/* Playback controls and actions */}
            <div className="flex items-center justify-between">
              {/* Left side: playback controls */}
              <PlaybackControls
                isPlaying={playback.isPlaying}
                loading={persistence.loading}
                isMuted={playback.isMuted}
                volume={playback.volume}
                loopZone={loopZone}
                onGoToStart={playback.goToStart}
                onStepBackward={() => playback.stepFrame('backward')}
                onStepForward={() => playback.stepFrame('forward')}
                onTogglePlay={playback.togglePlay}
                onAddMarker={markerManager.addMarkerAtPlayhead}
                onAddTrim={trimManager.addTrim}
                onToggleMute={() => playback.setIsMuted(!playback.isMuted)}
                onVolumeChange={handleVolumeChange}
              />

              {/* Right side: cancel/confirm */}
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button onClick={handleContinue} disabled={!isValid || persistence.loading || isExporting}>
                  {isExporting ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" className="mr-2">
                        <g fill="currentColor">
                          <g className="nc-loop-dots-4-24-icon-f">
                            <circle cx="4" cy="12" fill="currentColor" r="3"></circle>
                            <circle cx="12" cy="12" fill="currentColor" r="3"></circle>
                            <circle cx="20" cy="12" fill="currentColor" r="3"></circle>
                          </g>
                          <style>{`.nc-loop-dots-4-24-icon-f{--animation-duration:0.8s}.nc-loop-dots-4-24-icon-f *{opacity:.4;transform:scale(.75);animation:nc-loop-dots-4-anim var(--animation-duration) infinite}.nc-loop-dots-4-24-icon-f :nth-child(1){transform-origin:4px 12px;animation-delay:-.3s;animation-delay:calc(var(--animation-duration)/-2.666)}.nc-loop-dots-4-24-icon-f :nth-child(2){transform-origin:12px 12px;animation-delay:-.15s;animation-delay:calc(var(--animation-duration)/-5.333)}.nc-loop-dots-4-24-icon-f :nth-child(3){transform-origin:20px 12px}@keyframes nc-loop-dots-4-anim{0%,100%{opacity:.4;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}`}</style>
                        </g>
                      </svg>
                      Exporting
                    </>
                  ) : (
                    "Export"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </TooltipProvider>
    </Modal>
  );
}
