import { useState, useCallback, Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Trim } from "@/types";

// Color palette for trims
export const TRIM_COLORS = [
  { name: 'yellow', border: 'border-yellow-400', bg: 'bg-yellow-400/20', dot: 'bg-yellow-400', text: 'text-yellow-400' },
  { name: 'cyan', border: 'border-cyan-400', bg: 'bg-cyan-400/20', dot: 'bg-cyan-400', text: 'text-cyan-400' },
  { name: 'fuchsia', border: 'border-fuchsia-400', bg: 'bg-fuchsia-400/20', dot: 'bg-fuchsia-400', text: 'text-fuchsia-400' },
  { name: 'green', border: 'border-green-400', bg: 'bg-green-400/20', dot: 'bg-green-400', text: 'text-green-400' },
  { name: 'orange', border: 'border-orange-400', bg: 'bg-orange-400/20', dot: 'bg-orange-400', text: 'text-orange-400' },
];

interface UseTrimManagerOptions {
  trims: Trim[];
  setTrims: Dispatch<SetStateAction<Trim[]>>;
  nextTrimId: number;
  setNextTrimId: Dispatch<SetStateAction<number>>;
  duration: number;
  currentTime: number;
  loopZone: { start: number; end: number } | null;
  onLoopZoneClear: () => void;
  filePath: string;
}

interface UseTrimManagerReturn {
  addTrim: () => void;
  createTrim: (start: number, end: number) => void;
  updateTrim: (id: number, start: number, end: number, seekTo?: (time: number) => void) => void;
  deleteTrim: (id: number) => void;
  updateTrimName: (id: number, name: string) => void;
  addTrimWithDuration: (seconds: number) => void;
  detectScenes: (threshold: number) => Promise<void>;
  isDetectingScenes: boolean;
  colors: typeof TRIM_COLORS;
}

export function useTrimManager({
  trims,
  setTrims,
  nextTrimId,
  setNextTrimId,
  duration,
  currentTime,
  loopZone,
  onLoopZoneClear,
  filePath,
}: UseTrimManagerOptions): UseTrimManagerReturn {
  const [isDetectingScenes, setIsDetectingScenes] = useState(false);

  // Add a new trim at current playhead position (or from loop zone if active)
  const addTrim = useCallback(() => {
    let start: number;
    let end: number;

    if (loopZone) {
      start = loopZone.start;
      end = loopZone.end;
      onLoopZoneClear();
    } else {
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
  }, [loopZone, currentTime, duration, nextTrimId, trims.length, onLoopZoneClear, setTrims, setNextTrimId]);

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
  }, [nextTrimId, trims.length, duration, setTrims, setNextTrimId]);

  // Update a trim's start or end time
  const updateTrim = useCallback((id: number, startTime: number, endTime: number, seekTo?: (time: number) => void) => {
    setTrims(prev => prev.map(t =>
      t.id === id
        ? { ...t, startTime: Math.max(0, startTime), endTime: Math.min(duration, endTime) }
        : t
    ));

    // Update video position to show the change
    if (seekTo) {
      seekTo(startTime);
    }
  }, [duration, setTrims]);

  // Delete a trim by id
  const deleteTrim = useCallback((id: number) => {
    setTrims(prev => prev.filter(t => t.id !== id));
  }, [setTrims]);

  // Update trim name
  const updateTrimName = useCallback((id: number, name: string) => {
    setTrims(prev => prev.map(t =>
      t.id === id ? { ...t, name: name.trim() || undefined } : t
    ));
  }, [setTrims]);

  // Quick duration preset - adds a trim with specified duration at current position
  const addTrimWithDuration = useCallback((seconds: number) => {
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
  }, [currentTime, duration, nextTrimId, trims.length, setTrims, setNextTrimId]);

  // Auto-detect scenes and create trims at cut points
  const detectScenes = useCallback(async (threshold: number) => {
    if (isDetectingScenes || !filePath) return;

    setIsDetectingScenes(true);
    try {
      const timestamps = await invoke<number[]>("detect_scenes", {
        path: filePath,
        threshold,
      });

      // Create boundaries: 0 + detected cuts + duration
      const points = [0, ...timestamps, duration].sort((a, b) => a - b);

      // Create trims between consecutive points
      const newTrims: Trim[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        // Skip very short segments (< 0.5s)
        if (end - start < 0.5) continue;

        newTrims.push({
          id: nextTrimId + i,
          startTime: start,
          endTime: end,
          colorIndex: (trims.length + i) % TRIM_COLORS.length,
        });
      }

      if (newTrims.length > 0) {
        setTrims(prev => [...prev, ...newTrims]);
        setNextTrimId(prev => prev + newTrims.length);
      }
    } catch (err) {
      console.error("Scene detection failed:", err);
    } finally {
      setIsDetectingScenes(false);
    }
  }, [isDetectingScenes, filePath, duration, nextTrimId, trims.length, setTrims, setNextTrimId]);

  return {
    addTrim,
    createTrim,
    updateTrim,
    deleteTrim,
    updateTrimName,
    addTrimWithDuration,
    detectScenes,
    isDetectingScenes,
    colors: TRIM_COLORS,
  };
}
