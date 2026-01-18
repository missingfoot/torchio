import { useState, useCallback, Dispatch, SetStateAction } from "react";
import type { Marker } from "@/types";

interface UseMarkerManagerOptions {
  markers: Marker[];
  setMarkers: Dispatch<SetStateAction<Marker[]>>;
  nextMarkerId: number;
  setNextMarkerId: Dispatch<SetStateAction<number>>;
  duration: number;
  currentTime: number;
  loopZone: { start: number; end: number } | null;
  onLoopZoneClear: () => void;
}

interface UseMarkerManagerReturn {
  addMarker: (time: number) => void;
  addMarkerAtPlayhead: () => void;
  deleteMarker: (id: number) => void;
  updateMarkerName: (id: number, name: string) => void;
  selectedMarkerId: number | null;
  setSelectedMarkerId: (id: number | null) => void;
}

export function useMarkerManager({
  markers,
  setMarkers,
  nextMarkerId,
  setNextMarkerId,
  duration,
  currentTime,
  loopZone,
  onLoopZoneClear,
}: UseMarkerManagerOptions): UseMarkerManagerReturn {
  const [selectedMarkerId, setSelectedMarkerId] = useState<number | null>(null);

  // Add a marker at a specific time
  const addMarker = useCallback((time: number) => {
    // Avoid duplicates within threshold
    const snapThreshold = duration * 0.01;
    const isDuplicate = markers.some(m => Math.abs(m.time - time) < snapThreshold);
    if (isDuplicate) return;

    const newMarker: Marker = {
      id: nextMarkerId,
      time,
      name: `Chapter ${nextMarkerId}`,
    };
    setMarkers(prev => [...prev, newMarker].sort((a, b) => a.time - b.time));
    setNextMarkerId(prev => prev + 1);
  }, [duration, markers, nextMarkerId, setMarkers, setNextMarkerId]);

  // Delete a marker by id
  const deleteMarker = useCallback((id: number) => {
    setMarkers(prev => prev.filter(m => m.id !== id));
    if (selectedMarkerId === id) setSelectedMarkerId(null);
  }, [selectedMarkerId, setMarkers]);

  // Update marker name
  const updateMarkerName = useCallback((id: number, name: string) => {
    setMarkers(prev => prev.map(m => m.id === id ? { ...m, name: name.trim() || undefined } : m));
  }, [setMarkers]);

  // Add marker at playhead (or both ends of loop zone if active)
  const addMarkerAtPlayhead = useCallback(() => {
    if (loopZone) {
      addMarker(loopZone.start);
      addMarker(loopZone.end);
      onLoopZoneClear();
    } else {
      addMarker(currentTime);
    }
  }, [loopZone, currentTime, addMarker, onLoopZoneClear]);

  return {
    addMarker,
    addMarkerAtPlayhead,
    deleteMarker,
    updateMarkerName,
    selectedMarkerId,
    setSelectedMarkerId,
  };
}
