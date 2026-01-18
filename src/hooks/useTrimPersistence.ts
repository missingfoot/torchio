import { useState, useRef, useEffect, useCallback, Dispatch, SetStateAction } from "react";
import { Store } from "@tauri-apps/plugin-store";
import type { Trim, Marker } from "@/types";

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

interface UseTrimPersistenceOptions {
  filePath: string;
  enabled: boolean;
}

interface UseTrimPersistenceReturn {
  trims: Trim[];
  setTrims: Dispatch<SetStateAction<Trim[]>>;
  nextTrimId: number;
  setNextTrimId: Dispatch<SetStateAction<number>>;
  markers: Marker[];
  setMarkers: Dispatch<SetStateAction<Marker[]>>;
  nextMarkerId: number;
  setNextMarkerId: Dispatch<SetStateAction<number>>;
  loading: boolean;
  reset: () => void;
}

export function useTrimPersistence({
  filePath,
  enabled,
}: UseTrimPersistenceOptions): UseTrimPersistenceReturn {
  const loadedFileRef = useRef<string | null>(null);

  const [trims, setTrims] = useState<Trim[]>([]);
  const [nextTrimId, setNextTrimId] = useState(1);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [nextMarkerId, setNextMarkerId] = useState(1);
  const [loading, setLoading] = useState(true);

  // Reset function for external use
  const reset = useCallback(() => {
    loadedFileRef.current = null;
    setTrims([]);
    setNextTrimId(1);
    setMarkers([]);
    setNextMarkerId(1);
    setLoading(true);
  }, []);

  // Load saved data when modal opens
  useEffect(() => {
    if (!enabled) return;

    // Clear loaded file ref to prevent saving old data to new file
    loadedFileRef.current = null;
    setLoading(true);
    setTrims([]);
    setNextTrimId(1);
    setMarkers([]);
    setNextMarkerId(1);

    const loadData = async () => {
      try {
        const store = await getTrimStore();
        const key = getStorageKey(filePath);
        const savedTrims = await store.get<Trim[]>(`${key}_trims`);
        const savedNextTrimId = await store.get<number>(`${key}_nextId`);

        // Load markers with migration from old number[] format
        const savedMarkersRaw = await store.get<Marker[] | number[]>(`${key}_markers`);
        const savedNextMarkerId = await store.get<number>(`${key}_nextMarkerId`);

        // Migrate old number[] markers to Marker[] format
        let loadedMarkers: Marker[] = [];
        if (savedMarkersRaw && Array.isArray(savedMarkersRaw)) {
          if (savedMarkersRaw.length > 0) {
            if (typeof savedMarkersRaw[0] === 'number') {
              // Old format: number[] - migrate to Marker[]
              loadedMarkers = (savedMarkersRaw as number[]).map((time, index) => ({
                id: index + 1,
                time,
                name: `Chapter ${index + 1}`,
              }));
            } else {
              // New format: Marker[]
              loadedMarkers = savedMarkersRaw as Marker[];
            }
          }
        }

        setTrims(savedTrims ?? []);
        setNextTrimId(savedNextTrimId ?? (savedTrims?.length ?? 0) + 1);
        setMarkers(loadedMarkers);
        setNextMarkerId(savedNextMarkerId ?? (loadedMarkers.length > 0 ? Math.max(...loadedMarkers.map(m => m.id)) + 1 : 1));

        // Mark this file as loaded - enables saving
        loadedFileRef.current = filePath;
      } catch (e) {
        console.error("Failed to load data:", e);
        setTrims([]);
        setNextTrimId(1);
        setMarkers([]);
        setNextMarkerId(1);
        loadedFileRef.current = filePath; // Still enable saving even on error
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [enabled, filePath]);

  // Save trims when they change
  useEffect(() => {
    // Only save if this file's data has been loaded (prevents saving old data to new file)
    if (!enabled || loading || loadedFileRef.current !== filePath) return;

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
  }, [trims, nextTrimId, enabled, loading, filePath]);

  // Save markers when they change
  useEffect(() => {
    // Only save if this file's data has been loaded (prevents saving old data to new file)
    if (!enabled || loading || loadedFileRef.current !== filePath) return;

    const saveMarkers = async () => {
      try {
        const store = await getTrimStore();
        const key = getStorageKey(filePath);
        await store.set(`${key}_markers`, markers);
        await store.set(`${key}_nextMarkerId`, nextMarkerId);
        await store.save();
      } catch (e) {
        console.error("Failed to save markers:", e);
      }
    };

    saveMarkers();
  }, [markers, nextMarkerId, enabled, loading, filePath]);

  return {
    trims,
    setTrims,
    nextTrimId,
    setNextTrimId,
    markers,
    setMarkers,
    nextMarkerId,
    setNextMarkerId,
    loading,
    reset,
  };
}
