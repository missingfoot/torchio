import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, SquareSplitHorizontal, Plus, X, MousePointer, Scissors } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Modal, ModalHeader, ModalTitle } from "./ui/modal";
import { Button, ButtonGroup } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { TrimBar } from "./TrimBar";
import { formatDuration } from "@/lib/utils";
import type { TrimRange, Trim } from "@/types";

interface TrimModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  fileName: string;
  onConfirm: (ranges: TrimRange[]) => void;
  onCancel: () => void;
}

const QUICK_DURATIONS = [2, 5, 8, 10, 15, 20, 25, 30];

// Color palette for trims
const TRIM_COLORS = [
  { name: 'yellow', border: 'border-yellow-400', bg: 'bg-yellow-400/20', dot: 'bg-yellow-400', text: 'text-yellow-400' },
  { name: 'cyan', border: 'border-cyan-400', bg: 'bg-cyan-400/20', dot: 'bg-cyan-400', text: 'text-cyan-400' },
  { name: 'fuchsia', border: 'border-fuchsia-400', bg: 'bg-fuchsia-400/20', dot: 'bg-fuchsia-400', text: 'text-fuchsia-400' },
  { name: 'green', border: 'border-green-400', bg: 'bg-green-400/20', dot: 'bg-green-400', text: 'text-green-400' },
  { name: 'orange', border: 'border-orange-400', bg: 'bg-orange-400/20', dot: 'bg-orange-400', text: 'text-orange-400' },
];

type BarMode = 'select' | 'trim' | 'marker';

export function TrimModal({
  open,
  onOpenChange,
  filePath,
  fileName: _fileName,
  onConfirm,
  onCancel,
}: TrimModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [trims, setTrims] = useState<Trim[]>([]);
  const [nextTrimId, setNextTrimId] = useState(1);
  const [trimsVisible, setTrimsVisible] = useState(true);
  const [filmstrip, setFilmstrip] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [lockedTimes, setLockedTimes] = useState<number[]>([]);
  const [barMode, setBarMode] = useState<BarMode>('select');
  const [pendingTrimStart, setPendingTrimStart] = useState<number | null>(null);
  const [pendingTrimEnd, setPendingTrimEnd] = useState<number | null>(null); // Set during drag
  const [loopZone, setLoopZone] = useState<{ start: number; end: number } | null>(null);
  const [playheadLocked, setPlayheadLocked] = useState(false);
  const [showRemaining, setShowRemaining] = useState(false);

  const isValid = trims.length > 0;
  const videoSrc = convertFileSrc(filePath);

  // Load filmstrip for the trim bar when modal opens
  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setFilmstrip([]);
    setTrims([]);
    setNextTrimId(1);
    setTrimsVisible(true);
    setIsPlaying(false);
    setCurrentTime(0);
    setLockedTimes([]);
    setBarMode('select');
    setPendingTrimStart(null);
    setPendingTrimEnd(null);
    setLoopZone(null);
    setPlayheadLocked(false);

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
      } finally {
        setLoading(false);
      }
    };

    loadFilmstrip();
  }, [open, filePath]);

  // Handle video metadata loaded
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video && duration === 0) {
      setDuration(video.duration);
    }
  };

  // Handle video time updates (with loop zone support)
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    setCurrentTime(video.currentTime);

    // Loop within zone if playing and zone is active
    if (loopZone && isPlaying) {
      if (video.currentTime >= loopZone.end) {
        video.currentTime = loopZone.start;
      }
    }
  }, [loopZone, isPlaying]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play();
      setIsPlaying(true);
      // Keep lock state - don't unlock when playing
    }
  }, [isPlaying]);

  // Add a new trim at current playhead position (or from loop zone if active)
  const addTrim = useCallback(() => {
    let start: number;
    let end: number;

    // If loop zone exists, use its bounds
    if (loopZone) {
      start = loopZone.start;
      end = loopZone.end;
      setLoopZone(null);
    } else {
      // Default behavior: 5 seconds from playhead
      const defaultDuration = 5;
      start = currentTime;
      end = Math.min(start + defaultDuration, duration);
    }

    const newTrim: Trim = {
      id: nextTrimId,
      startTime: start,
      endTime: end,
      colorIndex: trims.length % TRIM_COLORS.length,
    };

    setTrims(prev => [...prev, newTrim]);
    setNextTrimId(prev => prev + 1);
  }, [loopZone, currentTime, duration, nextTrimId, trims.length]);

  // Create a trim with specific start and end times (from trim bar)
  const createTrim = useCallback((startTime: number, endTime: number) => {
    const newTrim: Trim = {
      id: nextTrimId,
      startTime: Math.max(0, startTime),
      endTime: Math.min(endTime, duration),
      colorIndex: trims.length % TRIM_COLORS.length,
    };

    setTrims(prev => [...prev, newTrim]);
    setNextTrimId(prev => prev + 1);
  }, [nextTrimId, trims.length, duration]);

  // Delete a trim by id
  const deleteTrim = useCallback((id: number) => {
    setTrims(prev => prev.filter(t => t.id !== id));
  }, []);

  // Update a trim's start or end time (snapping is handled in TrimBar)
  const updateTrim = useCallback((id: number, startTime: number, endTime: number) => {
    setTrims(prev => prev.map(t =>
      t.id === id
        ? { ...t, startTime: Math.max(0, startTime), endTime: Math.min(duration, endTime) }
        : t
    ));

    // Update video position to show the change
    if (videoRef.current) {
      videoRef.current.currentTime = startTime;
      setCurrentTime(startTime);
    }
  }, [duration]);

  const handleLockToggle = useCallback((time: number) => {
    // Add a new lock (avoid duplicates within threshold)
    const snapThreshold = duration * 0.01;
    setLockedTimes(prev => {
      const isDuplicate = prev.some(lt => Math.abs(lt - time) < snapThreshold);
      if (isDuplicate) return prev;
      return [...prev, time];
    });
  }, [duration]);

  const removeLock = (time: number) => {
    setLockedTimes(prev => prev.filter(t => t !== time));
  };

  // Add marker at playhead (or both ends of loop zone if active)
  const addMarkerAtPlayhead = useCallback(() => {
    if (loopZone) {
      // Add markers at both ends of loop zone
      handleLockToggle(loopZone.start);
      handleLockToggle(loopZone.end);
      setLoopZone(null);
    } else {
      // Default: add at current time
      handleLockToggle(currentTime);
    }
  }, [loopZone, currentTime, handleLockToggle]);

  const handleHover = (time: number | null) => {
    // Update video position in all modes (except when locked in select mode)
    if (isPlaying || time === null) return;
    if (barMode === 'select' && playheadLocked) return;

    const video = videoRef.current;
    if (video) {
      video.currentTime = time;
      setCurrentTime(time);
    }
  };

  // Seek to a specific time (used by bar in seek mode)
  const handleSeek = (time: number) => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = time;
      setCurrentTime(time);
    }
  };

  // Quick duration preset - adds a trim with specified duration at current position
  const handleQuickDuration = (seconds: number) => {
    const start = currentTime;
    const end = Math.min(start + seconds, duration);

    const newTrim: Trim = {
      id: nextTrimId,
      startTime: start,
      endTime: end,
      colorIndex: trims.length % TRIM_COLORS.length,
    };

    setTrims(prev => [...prev, newTrim]);
    setNextTrimId(prev => prev + 1);
    setPresetsOpen(false);
  };

  const goToStart = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      setCurrentTime(0);
    }
  }, []);

  const stepFrame = useCallback((direction: 'forward' | 'backward') => {
    const video = videoRef.current;
    if (!video || isPlaying) return;

    // Approximate frame duration (assuming ~30fps)
    const frameTime = 1 / 30;
    const newTime = direction === 'forward'
      ? Math.min(video.currentTime + frameTime, duration)
      : Math.max(video.currentTime - frameTime, 0);

    video.currentTime = newTime;
    setCurrentTime(newTime);
  }, [isPlaying, duration]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          stepFrame("backward");
          break;
        case "ArrowRight":
          e.preventDefault();
          stepFrame("forward");
          break;
        case "ArrowUp":
          e.preventDefault();
          goToStart();
          break;
        // Mode shortcuts
        case "Digit1":
        case "KeyS":
          e.preventDefault();
          setBarMode('select');
          setPendingTrimStart(null);
          setPendingTrimEnd(null);
          // Don't clear loopZone when switching to select mode (it's a select mode feature)
          break;
        case "Digit2":
        case "KeyT":
          e.preventDefault();
          setBarMode('trim');
          setLoopZone(null);
          break;
        case "Digit3":
        case "KeyM":
          e.preventDefault();
          setBarMode('marker');
          setPendingTrimStart(null);
          setPendingTrimEnd(null);
          setLoopZone(null);
          break;
        // Toggle trims visibility (moved from T to V)
        case "KeyV":
          e.preventDefault();
          setTrimsVisible(prev => !prev);
          break;
        // Escape clears pending trim and loop zone
        case "Escape":
          if (pendingTrimStart !== null || pendingTrimEnd !== null || loopZone !== null) {
            e.preventDefault();
            setPendingTrimStart(null);
            setPendingTrimEnd(null);
            setLoopZone(null);
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, togglePlay, stepFrame, goToStart, pendingTrimStart, pendingTrimEnd, loopZone]);

  const handleConfirm = () => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
    // Convert trims to TrimRange array
    const ranges: TrimRange[] = trims.map(t => ({
      startTime: t.startTime,
      endTime: t.endTime,
    }));
    onConfirm(ranges);
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

        {/* Video Preview + Sidebar - fills available space */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Video area */}
          <div className="flex-1 bg-black flex items-center justify-center relative overflow-hidden">
            <video
              ref={videoRef}
              src={videoSrc}
              className="max-w-full max-h-full object-contain"
              playsInline
              muted
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={() => {
                // Loop back to start of video
                if (videoRef.current) {
                  videoRef.current.currentTime = 0;
                  videoRef.current.play();
                }
              }}
            />

            {/* Play/Pause button overlay */}
            <button
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center group"
            >
              <div className="w-20 h-20 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {isPlaying ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 48 48" className="text-white">
                    <path fillRule="evenodd" clipRule="evenodd" d="M28 6H39V42H28V6Z" fill="currentColor"/>
                    <path fillRule="evenodd" clipRule="evenodd" d="M9 6H20V42H9V6Z" fill="currentColor"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 48 48" className="text-white ml-1">
                    <path d="M41.555,23.168l-30-20A1,1,0,0,0,10,4V44a1,1,0,0,0,1.555.832l30-20a1,1,0,0,0,0-1.664Z" fill="currentColor"/>
                  </svg>
                )}
              </div>
            </button>
          </div>

          {/* Sidebar with Tabs */}
          <div className="w-[260px] border-l bg-card flex flex-col">
            <Tabs defaultValue="trims" className="flex flex-col h-full">
              {/* Tabs header */}
              <div className="p-2 border-b flex items-center justify-between">
                <TabsList className="h-8">
                  <TabsTrigger value="trims" className="text-xs px-3">Trims</TabsTrigger>
                  <TabsTrigger value="markers" className="text-xs px-3">Markers</TabsTrigger>
                </TabsList>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={addTrim}
                      disabled={loading}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <p>Add trim at playhead</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Trims tab content */}
              <TabsContent value="trims" className="flex-1 overflow-y-auto p-2 space-y-1 mt-0">
                {trims.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground text-sm px-4">
                    <p>No trims yet</p>
                    <p className="text-xs mt-1">Click + to add a trim</p>
                  </div>
                ) : (
                  trims.map((trim, index) => {
                    const color = TRIM_COLORS[trim.colorIndex];
                    const trimDuration = trim.endTime - trim.startTime;
                    return (
                      <div
                        key={trim.id}
                        className="p-2 rounded bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${color.dot}`} />
                            <span className="text-sm font-medium">{index + 1}</span>
                            <span className={`text-xs ${color.text}`}>
                              {formatDuration(trim.startTime)} - {formatDuration(trim.endTime)}
                            </span>
                          </div>
                          <button
                            onClick={() => deleteTrim(trim.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground pl-4">
                          <span>{formatDuration(trimDuration)}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </TabsContent>

              {/* Markers tab content */}
              <TabsContent value="markers" className="flex-1 overflow-y-auto p-2 mt-0">
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground text-sm px-4">
                  <p>No markers yet</p>
                  <p className="text-xs mt-1">Use marker mode to add markers</p>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Controls */}
        <div className="p-4 border-t space-y-4">
          {/* Time display */}
          <div className="flex items-center justify-between text-sm">
            {/* Mode selector and markers */}
            <div className="flex items-center gap-4">
              {/* Mode selector */}
              <ButtonGroup>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="subtle"
                      size="sm"
                      onClick={() => setBarMode('select')}
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
                      onClick={() => setBarMode('trim')}
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
                      onClick={() => setBarMode('marker')}
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

              {/* Markers display */}
              {lockedTimes.length > 0 && (
                <div className="flex items-center gap-3">
                  {lockedTimes.map((lt, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-muted-foreground">{i + 1}</span>
                      <span className="text-red-500">{formatDuration(lt)}</span>
                      <button
                        onClick={() => removeLock(lt)}
                        className="text-red-500 hover:text-red-400 ml-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Playhead / Total duration - click to toggle elapsed/remaining */}
            <button
              onClick={() => setShowRemaining(!showRemaining)}
              className="flex items-center gap-2 hover:bg-muted/50 px-2 py-1 -my-1 rounded transition-colors"
            >
              <span className="text-foreground tabular-nums">
                {showRemaining ? `-${formatDuration(duration - currentTime)}` : formatDuration(currentTime)}
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="text-muted-foreground tabular-nums">{formatDuration(duration)}</span>
            </button>
          </div>

          {/* Trim bar */}
          {duration > 0 ? (
            <TrimBar
              duration={duration}
              trims={trims}
              trimsVisible={trimsVisible}
              onTrimUpdate={updateTrim}
              onHover={handleHover}
              lockedTimes={lockedTimes}
              filmstrip={filmstrip}
              currentTime={currentTime}
              colors={TRIM_COLORS}
              mode={barMode}
              pendingTrimStart={pendingTrimStart}
              pendingTrimEnd={pendingTrimEnd}
              onSeek={handleSeek}
              onTrimCreate={createTrim}
              onMarkerAdd={handleLockToggle}
              onPendingTrimChange={setPendingTrimStart}
              onPendingTrimEndChange={setPendingTrimEnd}
              loopZone={loopZone}
              onLoopZoneChange={setLoopZone}
              playheadLocked={playheadLocked}
              onPlayheadLockChange={setPlayheadLocked}
            />
          ) : (
            <div className="h-16 bg-muted rounded-lg flex items-center justify-center text-sm text-muted-foreground">
              {loading ? "Loading..." : "Could not load video"}
            </div>
          )}

          {/* Playback controls and actions */}
          <div className="flex items-center justify-between">
            {/* Left side: playback controls + presets */}
            <div className="flex items-center gap-2">
              {/* Restart */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="subtle"
                    size="icon"
                    onClick={goToStart}
                    disabled={loading}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                      <path d="M3 3v5h5"/>
                    </svg>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Restart <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">↑</kbd></p>
                </TooltipContent>
              </Tooltip>

              <ButtonGroup>
                {/* Step backward */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="subtle"
                      size="icon"
                      onClick={() => stepFrame('backward')}
                      disabled={loading || isPlaying}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18 18l-8.5-6L18 6v12zM8 6v12H6V6h2z"/>
                      </svg>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Step back <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">←</kbd></p>
                  </TooltipContent>
                </Tooltip>

                {/* Play/Pause */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="subtle"
                      size="icon"
                      onClick={togglePlay}
                      disabled={loading}
                    >
                      {isPlaying ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 48 48" fill="currentColor">
                          <path fillRule="evenodd" clipRule="evenodd" d="M28 6H39V42H28V6Z"/>
                          <path fillRule="evenodd" clipRule="evenodd" d="M9 6H20V42H9V6Z"/>
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 48 48" fill="currentColor">
                          <path d="M41.555,23.168l-30-20A1,1,0,0,0,10,4V44a1,1,0,0,0,1.555.832l30-20a1,1,0,0,0,0-1.664Z"/>
                        </svg>
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>{isPlaying ? "Pause" : "Play"} <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">Space</kbd></p>
                  </TooltipContent>
                </Tooltip>

                {/* Step forward */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="subtle"
                      size="icon"
                      onClick={() => stepFrame('forward')}
                      disabled={loading || isPlaying}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
                      </svg>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Step forward <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">→</kbd></p>
                  </TooltipContent>
                </Tooltip>
              </ButtonGroup>

              {/* Add marker */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="subtle"
                    size="icon"
                    onClick={addMarkerAtPlayhead}
                    disabled={loading}
                    className={lockedTimes.length > 0 ? "text-red-500" : ""}
                  >
                    <SquareSplitHorizontal className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{loopZone ? "Add markers at selection" : "Add marker at playhead"}</p>
                </TooltipContent>
              </Tooltip>

              {/* Toggle trims visibility */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="subtle"
                    size="icon"
                    onClick={() => setTrimsVisible(!trimsVisible)}
                    disabled={loading || trims.length === 0}
                    className={trimsVisible && trims.length > 0 ? "text-yellow-400" : ""}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="6" r="3"/>
                      <path d="M8.12 8.12 12 12"/>
                      <path d="M20 4 8.12 15.88"/>
                      <circle cx="6" cy="18" r="3"/>
                      <path d="M14.8 14.8 20 20"/>
                    </svg>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{trimsVisible ? "Hide" : "Show"} trims <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">V</kbd></p>
                </TooltipContent>
              </Tooltip>

              {/* Presets dropdown */}
              <div className="relative">
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setPresetsOpen(!presetsOpen)}
                  disabled={loading}
                  className="gap-1 h-9"
                >
                  Presets
                  <ChevronDown className="h-4 w-4" />
                </Button>
                {presetsOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setPresetsOpen(false)}
                    />
                    <div className="absolute bottom-full left-0 mb-1 bg-background border rounded-md shadow-lg z-50 py-1 min-w-[80px]">
                      {QUICK_DURATIONS.map((sec) => (
                        <button
                          key={sec}
                          onClick={() => handleQuickDuration(sec)}
                          disabled={duration < sec}
                          className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right side: cancel/confirm */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={!isValid || loading}>
                Continue
              </Button>
            </div>
          </div>
        </div>
      </div>
      </TooltipProvider>
    </Modal>
  );
}
