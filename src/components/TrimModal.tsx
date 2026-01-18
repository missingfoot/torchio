import { useState, useEffect, useRef, useCallback } from "react";
import { SquareSplitHorizontal, Plus, X, MousePointer, Scissors, Trash2, Eye, EyeOff } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { Modal, ModalHeader, ModalTitle } from "./ui/modal";
import { Button, ButtonGroup } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
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

// Persistence store for trims/markers
let trimStore: Store | null = null;
async function getTrimStore(): Promise<Store> {
  if (!trimStore) {
    trimStore = await Store.load("trim-data.json");
  }
  return trimStore;
}

// Create a safe key from file path
function getStorageKey(filePath: string): string {
  return filePath.replace(/[\\/:*?"<>|]/g, "_");
}

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
  const prevTimeRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameCacheRef = useRef<Map<number, string>>(new Map());
  const pendingCaptureRef = useRef<number | null>(null);
  const [cachedFrame, setCachedFrame] = useState<string | null>(null);
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
  const [sidebarTab, setSidebarTab] = useState<'trims' | 'markers'>('trims');
  const [markersVisible, setMarkersVisible] = useState(true);
  const [editingTrimId, setEditingTrimId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  const isValid = trims.length > 0;
  const videoSrc = convertFileSrc(filePath);

  // Frame cache helpers - quantize time to 0.1s intervals for cache keys
  const getCacheKey = useCallback((time: number) => Math.round(time * 10) / 10, []);

  const captureFrame = useCallback((video: HTMLVideoElement, time: number) => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const key = getCacheKey(time);

    // Limit cache size to ~200 frames (LRU-style: just cap the size)
    if (frameCacheRef.current.size > 200) {
      const firstKey = frameCacheRef.current.keys().next().value;
      if (firstKey !== undefined) frameCacheRef.current.delete(firstKey);
    }

    frameCacheRef.current.set(key, dataUrl);
  }, [getCacheKey]);

  // Load filmstrip and saved data when modal opens
  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setFilmstrip([]);
    setTrimsVisible(true);
    setIsPlaying(false);
    setCurrentTime(0);
    setBarMode('select');
    setPendingTrimStart(null);
    setPendingTrimEnd(null);
    setLoopZone(null);
    setPlayheadLocked(false);
    setCachedFrame(null);
    frameCacheRef.current.clear();

    const loadData = async () => {
      try {
        // Load video duration and filmstrip
        const dur = await invoke<number>("get_video_duration", { path: filePath });
        setDuration(dur);

        const frames = await invoke<string[]>("extract_filmstrip", {
          path: filePath,
          duration: dur,
          count: 10,
        });
        setFilmstrip(frames);

        // Load saved trims and markers for this file
        const store = await getTrimStore();
        const key = getStorageKey(filePath);
        const savedTrims = await store.get<Trim[]>(`${key}_trims`);
        const savedMarkers = await store.get<number[]>(`${key}_markers`);
        const savedNextId = await store.get<number>(`${key}_nextId`);

        if (savedTrims && savedTrims.length > 0) {
          setTrims(savedTrims);
          setNextTrimId(savedNextId ?? savedTrims.length + 1);
        } else {
          setTrims([]);
          setNextTrimId(1);
        }

        if (savedMarkers && savedMarkers.length > 0) {
          setLockedTimes(savedMarkers);
        } else {
          setLockedTimes([]);
        }
      } catch (e) {
        console.error("Failed to load data:", e);
        setTrims([]);
        setNextTrimId(1);
        setLockedTimes([]);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [open, filePath]);

  // Save trims when they change
  useEffect(() => {
    if (!open || loading) return;

    const saveTrims = async () => {
      try {
        const store = await getTrimStore();
        const key = getStorageKey(filePath);
        await store.set(`${key}_trims`, trims);
        await store.set(`${key}_nextId`, nextTrimId);
        await store.save();
      } catch (e) {
        console.error("Failed to save trims:", e);
      }
    };

    saveTrims();
  }, [trims, nextTrimId, open, loading, filePath]);

  // Save markers when they change
  useEffect(() => {
    if (!open || loading) return;

    const saveMarkers = async () => {
      try {
        const store = await getTrimStore();
        const key = getStorageKey(filePath);
        await store.set(`${key}_markers`, lockedTimes);
        await store.save();
      } catch (e) {
        console.error("Failed to save markers:", e);
      }
    };

    saveMarkers();
  }, [lockedTimes, open, loading, filePath]);

  // Handle video metadata loaded
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video && duration === 0) {
      setDuration(video.duration);
    }
  };

  // Handle video time updates (UI only - looping handled by RAF loop)
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
  }, []);

  // High-precision playback loop using requestAnimationFrame (~60fps)
  // This ensures we catch trim boundaries precisely, unlike timeupdate (~4fps)
  useEffect(() => {
    if (!isPlaying) {
      // Stop the RAF loop when paused
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    let lastCaptureTime = -1;

    const checkPlayback = () => {
      const video = videoRef.current;
      if (!video || video.paused) {
        animationFrameRef.current = null;
        return;
      }

      const prevTime = prevTimeRef.current;
      const currTime = video.currentTime;
      prevTimeRef.current = currTime;

      // Update UI at 60fps for smooth playhead movement
      setCurrentTime(currTime);

      // Cache frames during playback (every 0.1s to match cache key quantization)
      const cacheKey = getCacheKey(currTime);
      if (cacheKey !== lastCaptureTime && !frameCacheRef.current.has(cacheKey)) {
        captureFrame(video, currTime);
        lastCaptureTime = cacheKey;
      }

      // Loop zone takes priority
      if (loopZone) {
        if (currTime >= loopZone.end) {
          video.currentTime = loopZone.start;
          prevTimeRef.current = loopZone.start;
        }
        animationFrameRef.current = requestAnimationFrame(checkPlayback);
        return;
      }

      // Trim looping - works in all modes when playing
      if (trims.length > 0) {
        for (const trim of trims) {
          const wasInTrim = prevTime >= trim.startTime && prevTime < trim.endTime;
          const nowAtOrPastEnd = currTime >= trim.endTime;

          if (wasInTrim && nowAtOrPastEnd) {
            // Crossed from inside trim to past end - loop back
            video.currentTime = trim.startTime;
            prevTimeRef.current = trim.startTime;
            break;
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(checkPlayback);
    };

    // Start the loop
    animationFrameRef.current = requestAnimationFrame(checkPlayback);

    // Cleanup on unmount or when deps change
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, loopZone, trims, getCacheKey, captureFrame]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play();
      setIsPlaying(true);
      setCachedFrame(null); // Hide cache overlay during playback
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
      prevTimeRef.current = startTime;
    }
  }, [duration]);

  // Update trim name
  const updateTrimName = useCallback((id: number, name: string) => {
    setTrims(prev => prev.map(t =>
      t.id === id ? { ...t, name: name.trim() || undefined } : t
    ));
  }, []);

  // Start editing a trim name
  const startEditingTrimName = useCallback((trim: Trim, index: number) => {
    setEditingTrimId(trim.id);
    setEditingName(trim.name || `Trim ${index + 1}`);
  }, []);

  // Save the edited trim name
  const saveEditingTrimName = useCallback(() => {
    if (editingTrimId !== null) {
      updateTrimName(editingTrimId, editingName);
      setEditingTrimId(null);
      setEditingName('');
    }
  }, [editingTrimId, editingName, updateTrimName]);

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
    // Handle hover end - hide cache overlay and precise seek
    if (time === null) {
      setCachedFrame(null);
      pendingCaptureRef.current = null;
      const video = videoRef.current;
      if (video && !isPlaying) {
        video.currentTime = prevTimeRef.current;
      }
      return;
    }

    // Skip if playing or locked
    if (isPlaying) return;
    if (barMode === 'select' && playheadLocked) return;

    const video = videoRef.current;
    if (!video) return;

    // Update UI and refs
    setCurrentTime(time);
    prevTimeRef.current = time;

    // Check frame cache first
    const cacheKey = getCacheKey(time);
    const cached = frameCacheRef.current.get(cacheKey);

    if (cached) {
      // Cache hit! Show cached frame instantly (no video seek needed)
      setCachedFrame(cached);
    } else {
      // Cache miss - use accurate seek (not fastSeek) to get exact frame
      setCachedFrame(null);
      pendingCaptureRef.current = time;
      video.currentTime = time; // Accurate seek for correct frame capture
    }
  };

  // Capture frames after video seeks (for caching)
  const handleSeeked = useCallback(() => {
    const video = videoRef.current;
    if (!video || isPlaying) return;

    // Capture frame if we have a pending capture request
    if (pendingCaptureRef.current !== null) {
      captureFrame(video, pendingCaptureRef.current);
      pendingCaptureRef.current = null;
    }
  }, [isPlaying, captureFrame]);

  // Seek to a specific time (used by bar in seek mode)
  const handleSeek = (time: number) => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = time;
      setCurrentTime(time);
      prevTimeRef.current = time;
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
      prevTimeRef.current = 0;
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
    prevTimeRef.current = newTime;
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
              preload="metadata"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onSeeked={handleSeeked}
              onEnded={() => {
                // Loop back to start of video
                if (videoRef.current) {
                  videoRef.current.currentTime = 0;
                  prevTimeRef.current = 0;
                  videoRef.current.play();
                }
              }}
            />

            {/* Cached frame overlay - shows instantly when scrubbing cached areas */}
            {cachedFrame && (
              <img
                src={cachedFrame}
                alt=""
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              />
            )}

            {/* Play/Pause button overlay */}
            <button
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center group"
            >
              <div className="w-20 h-20 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {isPlaying ? (
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
          <div className="w-[260px] border-l bg-card flex flex-col">
            {/* Tab switcher */}
            <div className="p-2">
              <ButtonGroup className="w-full">
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setSidebarTab('trims')}
                  className={`flex-1 ${sidebarTab === 'trims' ? 'bg-muted text-foreground' : ''}`}
                >
                  Trims
                </Button>
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setSidebarTab('markers')}
                  className={`flex-1 ${sidebarTab === 'markers' ? 'bg-muted text-foreground' : ''}`}
                >
                  Markers
                </Button>
              </ButtonGroup>
            </div>

            {/* Action bar */}
            <div className="px-2 pt-1.5 pb-3 border-b flex items-center gap-2">
              <Button
                variant="subtle"
                size="sm"
                className="flex-1"
                onClick={sidebarTab === 'trims' ? addTrim : addMarkerAtPlayhead}
                disabled={loading}
              >
                <Plus className="h-4 w-4 mr-1" />
                {sidebarTab === 'trims' ? 'Trim' : 'Marker'}
              </Button>
              {sidebarTab === 'trims' && (
                <div className="relative flex-1">
                  <Button
                    variant="subtle"
                    size="sm"
                    className="w-full"
                    onClick={() => setPresetsOpen(!presetsOpen)}
                    disabled={loading}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Trim preset
                  </Button>
                  {presetsOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setPresetsOpen(false)}
                      />
                      <div className="absolute top-full left-0 mt-1 bg-background border rounded-md shadow-lg z-50 py-1 min-w-full">
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
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {sidebarTab === 'trims' ? (
                trims.length === 0 ? (
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
                        className="flex rounded bg-muted/50 hover:bg-muted transition-colors overflow-hidden cursor-pointer"
                        onClick={() => handleSeek(trim.startTime)}
                      >
                        {/* Color bar */}
                        <div className={`w-1 ${color.dot}`} />
                        {/* Content */}
                        <div className="flex-1 p-2">
                          {/* Row 1: Name and delete */}
                          <div className="flex items-center justify-between">
                            {editingTrimId === trim.id ? (
                              <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    saveEditingTrimName();
                                  } else if (e.key === 'Escape') {
                                    setEditingTrimId(null);
                                    setEditingName('');
                                  }
                                }}
                                onBlur={saveEditingTrimName}
                                onFocus={(e) => e.target.select()}
                                autoFocus
                                className={`text-sm font-medium ${color.text} bg-transparent outline-none w-full mr-2`}
                              />
                            ) : (
                              <span
                                className={`text-sm font-medium ${color.text} cursor-text`}
                                onClick={(e) => { e.stopPropagation(); startEditingTrimName(trim, index); }}
                              >
                                {trim.name || `Trim ${index + 1}`}
                              </span>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteTrim(trim.id); }}
                              className="text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          {/* Row 2: Times */}
                          <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                            <span>
                              {formatDuration(trim.startTime)} -&gt; {formatDuration(trim.endTime)}
                            </span>
                            <span>{formatDuration(trimDuration)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground text-sm px-4">
                  <p>No markers yet</p>
                  <p className="text-xs mt-1">Use marker mode to add markers</p>
                </div>
              )}
            </div>

            {/* Bottom bar */}
            <div className="px-2 py-2 border-t flex gap-2">
              {sidebarTab === 'trims' ? (
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setTrimsVisible(!trimsVisible)}
                  disabled={trims.length === 0}
                  className="flex-1"
                >
                  {trimsVisible ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
                  {trimsVisible ? "Hide trims" : "Show trims"}
                </Button>
              ) : (
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => setMarkersVisible(!markersVisible)}
                  disabled={lockedTimes.length === 0}
                  className="flex-1"
                >
                  {markersVisible ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
                  {markersVisible ? "Hide markers" : "Show markers"}
                </Button>
              )}
              <Button
                variant="subtle"
                size="sm"
                className="flex-1 hover:bg-red-500/20 hover:text-red-400"
                onClick={() => sidebarTab === 'trims' ? setTrims([]) : setLockedTimes([])}
                disabled={sidebarTab === 'trims' ? trims.length === 0 : lockedTimes.length === 0}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear all
              </Button>
            </div>
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
              markersVisible={markersVisible}
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
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M10,1H3A1,1,0,0,0,3,3h7a3,3,0,0,1,0,6H4.414L6.707,6.707A1,1,0,0,0,5.293,5.293l-4,4a1,1,0,0,0,0,1.414l4,4a1,1,0,1,0,1.414-1.414L4.414,11H10A5,5,0,0,0,10,1Z"/>
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
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4,8.001C4,8.327,4.159,8.633,4.427,8.82l10,7c0.305,0.214,0.704,0.238,1.035,0.068 C15.793,15.715,16,15.374,16,15.001V0.999c0-0.373-0.207-0.715-0.538-0.887c-0.331-0.17-0.73-0.146-1.035,0.068l-10,7 C4.159,7.367,4,7.673,4,7.999C4,8,4,8,4,8.001C4,8,4,8,4,8.001z"/>
                        <path d="M1,0c0.552,0,1,0.447,1,1v14c0,0.553-0.448,1-1,1s-1-0.447-1-1L0,1C0,0.447,0.448,0,1,0z"/>
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
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M5,1H2C1.4,1,1,1.4,1,2v12c0,0.6,0.4,1,1,1h3c0.6,0,1-0.4,1-1V2C6,1.4,5.6,1,5,1z"/>
                          <path d="M14,1h-3c-0.6,0-1,0.4-1,1v12c0,0.6,0.4,1,1,1h3c0.6,0,1-0.4,1-1V2C15,1.4,14.6,1,14,1z"/>
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M14,7.999c0-0.326-0.159-0.632-0.427-0.819l-10-7C3.269-0.034,2.869-0.058,2.538,0.112 C2.207,0.285,2,0.626,2,0.999v14.001c0,0.373,0.207,0.715,0.538,0.887c0.331,0.17,0.73,0.146,1.035-0.068l10-7 C13.841,8.633,14,8.327,14,8.001C14,8,14,8,14,7.999C14,8,14,8,14,7.999z"/>
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
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M12,7.999c0-0.326-0.159-0.632-0.427-0.819l-10-7C1.269-0.034,0.869-0.058,0.538,0.112 C0.207,0.285,0,0.626,0,0.999v14.001c0,0.373,0.207,0.715,0.538,0.887c0.331,0.17,0.73,0.146,1.035-0.068l10-7 C11.841,8.633,12,8.327,12,8.001C12,8,12,8,12,7.999C12,8,12,8,12,7.999z"/>
                        <path d="M15,16c-0.552,0-1-0.447-1-1V1c0-0.553,0.448-1,1-1s1,0.447,1,1v14C16,15.553,15.552,16,15,16z"/>
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
                  >
                    <SquareSplitHorizontal className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{loopZone ? "Add markers at selection" : "Add marker at playhead"}</p>
                </TooltipContent>
              </Tooltip>

              {/* Add trim at playhead */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="subtle"
                    size="icon"
                    onClick={addTrim}
                    disabled={loading}
                  >
                    <Scissors className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{loopZone ? "Add trim from selection" : "Add trim at playhead"}</p>
                </TooltipContent>
              </Tooltip>

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
