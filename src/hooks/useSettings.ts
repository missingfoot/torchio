import { useState, useEffect } from "react";
import { Store } from "@tauri-apps/plugin-store";
import type { ConversionSettings } from "../types";

const STORE_PATH = "settings.json";

const DEFAULT_SETTINGS: ConversionSettings = {
  videoTargetMB: 40,
  webpTargetMB: 3,
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
        const videoTarget = await s.get<number>("videoTargetMB");
        const webpTarget = await s.get<number>("webpTargetMB");

        setSettings({
          videoTargetMB: videoTarget ?? DEFAULT_SETTINGS.videoTargetMB,
          webpTargetMB: webpTarget ?? DEFAULT_SETTINGS.webpTargetMB,
        });
      } catch (e) {
        console.error("Failed to load settings:", e);
      } finally {
        setLoaded(true);
      }
    }
    loadSettings();
  }, []);

  const updateSettings = async (newSettings: Partial<ConversionSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);

    try {
      const s = await getStore();
      if (newSettings.videoTargetMB !== undefined) {
        await s.set("videoTargetMB", newSettings.videoTargetMB);
      }
      if (newSettings.webpTargetMB !== undefined) {
        await s.set("webpTargetMB", newSettings.webpTargetMB);
      }
      await s.save();
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  return { settings, updateSettings, loaded };
}
