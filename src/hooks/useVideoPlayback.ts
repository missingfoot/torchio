import { useState, useRef, useCallback, useEffect, RefObject, MutableRefObject } from "react";
import type { Trim } from "@/types";

interface UseVideoPlaybackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  duration: number;
  loopZone: { start: number; end: number } | null;
  trims: Trim[];
  onFrameCapture?: (time: number) => void;
  getCacheKey?: (time: number) => number;
  frameCacheRef?: MutableRefObject<Map<number, string>>;
}

interface UseVideoPlaybackReturn {
  isPlaying: boolean;
  currentTime: number;
  setCurrentTime: (time: number) => void;
  togglePlay: () => void;
  goToStart: () => void;
  stepFrame: (direction: 'forward' | 'backward') => void;
  seekTo: (time: number) => void;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
  volume: number;
  setVolume: (volume: number) => void;
  prevTimeRef: MutableRefObject<number>;
}

export function useVideoPlayback({
  videoRef,
  duration,
  loopZone,
  trims,
  onFrameCapture,
  getCacheKey,
  frameCacheRef,
}: UseVideoPlaybackOptions): UseVideoPlaybackReturn {
  const prevTimeRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.7);

  // Sync volume to video element
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
    }
  }, [volume, videoRef]);

  // High-precision playback loop using requestAnimationFrame (~60fps)
  useEffect(() => {
    if (!isPlaying) {
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
      if (onFrameCapture && getCacheKey && frameCacheRef?.current) {
        const cacheKey = getCacheKey(currTime);
        if (cacheKey !== lastCaptureTime && !frameCacheRef.current.has(cacheKey)) {
          onFrameCapture(currTime);
          lastCaptureTime = cacheKey;
        }
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
            video.currentTime = trim.startTime;
            prevTimeRef.current = trim.startTime;
            break;
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(checkPlayback);
    };

    animationFrameRef.current = requestAnimationFrame(checkPlayback);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, loopZone, trims, onFrameCapture, getCacheKey, frameCacheRef, videoRef]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      // Sync video position to current UI state before playing
      video.currentTime = currentTime;
      prevTimeRef.current = currentTime;
      video.play().catch(() => {
        // Ignore AbortError
      });
      setIsPlaying(true);
    }
  }, [isPlaying, currentTime, videoRef]);

  const goToStart = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      setCurrentTime(0);
      prevTimeRef.current = 0;
    }
  }, [videoRef]);

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
  }, [isPlaying, duration, videoRef]);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = time;
      setCurrentTime(time);
      prevTimeRef.current = time;
    }
  }, [videoRef]);

  return {
    isPlaying,
    currentTime,
    setCurrentTime,
    togglePlay,
    goToStart,
    stepFrame,
    seekTo,
    isMuted,
    setIsMuted,
    volume,
    setVolume,
    prevTimeRef,
  };
}
