import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface UseFrameCacheOptions {
  filePath: string;
  duration: number;
}

interface UseFrameCacheReturn {
  getCachedFrame: (time: number) => string | null;
  captureFrame: (time: number) => void;
  prefetchAround: (time: number, forward?: number, backward?: number) => void;
  cachedTimes: number[];
  clearCache: () => void;
  getCacheKey: (time: number) => number;
}

export function useFrameCache({
  filePath,
  duration,
}: UseFrameCacheOptions): UseFrameCacheReturn {
  const frameCacheRef = useRef<Map<number, string>>(new Map());
  const capturingRef = useRef<Set<number>>(new Set());
  const failedCapturesRef = useRef<Set<number>>(new Set());
  const captureQueueRef = useRef<number[]>([]);
  const processingQueueRef = useRef<boolean>(false);

  const [cachedTimes, setCachedTimes] = useState<number[]>([]);

  // Quantize time to 0.1s intervals for cache keys
  const getCacheKey = useCallback((time: number) => Math.round(time * 10) / 10, []);

  // Get a cached frame by time
  const getCachedFrame = useCallback((time: number): string | null => {
    const key = getCacheKey(time);
    return frameCacheRef.current.get(key) ?? null;
  }, [getCacheKey]);

  // Process the capture queue one at a time to prevent backend race conditions
  const processQueue = useCallback(async () => {
    if (processingQueueRef.current || captureQueueRef.current.length === 0) {
      return;
    }

    processingQueueRef.current = true;

    while (captureQueueRef.current.length > 0) {
      const key = captureQueueRef.current.shift()!;

      // Skip if already cached or failed
      if (frameCacheRef.current.has(key) || failedCapturesRef.current.has(key)) {
        continue;
      }

      capturingRef.current.add(key);

      try {
        const dataUrl = await invoke<string>("extract_frame", { path: filePath, timestamp: key });

        // Limit cache size to ~400 frames (FIFO eviction)
        if (frameCacheRef.current.size > 400) {
          const firstKey = frameCacheRef.current.keys().next().value;
          if (firstKey !== undefined) frameCacheRef.current.delete(firstKey);
        }

        frameCacheRef.current.set(key, dataUrl);
        setCachedTimes(prev => [...prev, key]);
      } catch (err) {
        console.error(`[CACHE] Failed to capture frame at ${key}s:`, err);
        failedCapturesRef.current.add(key);
      } finally {
        capturingRef.current.delete(key);
      }
    }

    processingQueueRef.current = false;
  }, [filePath]);

  // Queue a frame for capture (non-blocking, sequential processing)
  const captureFrame = useCallback((time: number) => {
    const key = getCacheKey(time);

    // Skip if already cached, failed, capturing, or already queued
    if (
      frameCacheRef.current.has(key) ||
      failedCapturesRef.current.has(key) ||
      capturingRef.current.has(key) ||
      captureQueueRef.current.includes(key)
    ) {
      return;
    }

    captureQueueRef.current.push(key);
    processQueue();
  }, [getCacheKey, processQueue]);

  // Prefetch frames around a given time (2:1 ratio forward:backward)
  const prefetchAround = useCallback((fromTime: number, forwardCount: number = 100, backwardCount: number = 50) => {
    // Clear any pending prefetch frames to prioritize new position
    captureQueueRef.current = [];

    // Interleave forward and backward: 2 forward, 1 backward
    let fwd = 1;
    let bwd = 1;
    while (fwd <= forwardCount || bwd <= backwardCount) {
      // 2 forward frames
      if (fwd <= forwardCount) {
        const time = fromTime + (fwd * 0.1);
        if (time <= duration) captureFrame(time);
        fwd++;
      }
      if (fwd <= forwardCount) {
        const time = fromTime + (fwd * 0.1);
        if (time <= duration) captureFrame(time);
        fwd++;
      }
      // 1 backward frame
      if (bwd <= backwardCount) {
        const time = fromTime - (bwd * 0.1);
        if (time >= 0) captureFrame(time);
        bwd++;
      }
    }
  }, [captureFrame, duration]);

  // Clear all cache data
  const clearCache = useCallback(() => {
    frameCacheRef.current.clear();
    capturingRef.current.clear();
    failedCapturesRef.current.clear();
    captureQueueRef.current = [];
    processingQueueRef.current = false;
    setCachedTimes([]);
  }, []);

  // Auto-prefetch when paused - requires external trigger via effect in parent
  // This hook doesn't know about isPlaying state, so parent handles that

  return {
    getCachedFrame,
    captureFrame,
    prefetchAround,
    cachedTimes,
    clearCache,
    getCacheKey,
  };
}
