import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import { FORMATS } from "../lib/formats";
import type { ConversionSettings, FormatId } from "../types";

const STORE_PATH = "settings.json";

// Build default target sizes from format configs
function getDefaultTargetSizes(): Record<FormatId, number> {
  const sizes: Record<FormatId, number> = {};
  for (const format of Object.values(FORMATS)) {
    sizes[format.id] = format.sizeDefault;
  }
  return sizes;
}

const DEFAULT_SETTINGS: ConversionSettings = {
  targetSizes: getDefaultTargetSizes(),
};

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load(STORE_PATH);
  }
  return store;
}

export function useSettings() {
  const [settings, setSettings] = useState<ConversionSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const s = await getStore();
        const savedSizes = await s.get<Record<FormatId, number>>("targetSizes");

        // Merge saved sizes with defaults (so new formats get their defaults)
        const targetSizes = {
          ...DEFAULT_SETTINGS.targetSizes,
          ...savedSizes,
        };

        setSettings({ targetSizes });
      } catch (e) {
        console.error("Failed to load settings:", e);
      } finally {
        setLoaded(true);
      }
    }
    loadSettings();
  }, []);

  // Update target size for a specific format
  const updateTargetSize = async (formatId: FormatId, size: number) => {
    const updated = {
      targetSizes: { ...settings.targetSizes, [formatId]: size },
    };
    setSettings(updated);

    try {
      const s = await getStore();
      await s.set("targetSizes", updated.targetSizes);
      await s.save();
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  // Get target size for a format (with fallback to format default)
  const getTargetSize = (formatId: FormatId): number => {
    return settings.targetSizes[formatId] ?? FORMATS[formatId]?.sizeDefault ?? 10;
  };

  return { settings, updateTargetSize, getTargetSize, loaded };
}
