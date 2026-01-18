import { useEffect } from "react";

type BarMode = 'select' | 'trim' | 'marker';

interface UseTrimKeyboardShortcutsOptions {
  enabled: boolean;
  togglePlay: () => void;
  stepFrame: (dir: 'forward' | 'backward') => void;
  goToStart: () => void;
  setBarMode: (mode: BarMode) => void;
  clearPendingTrim: () => void;
  clearLoopZone: () => void;
  toggleTrimsVisible: () => void;
  pendingTrimStart: number | null;
  loopZone: { start: number; end: number } | null;
}

export function useTrimKeyboardShortcuts({
  enabled,
  togglePlay,
  stepFrame,
  goToStart,
  setBarMode,
  clearPendingTrim,
  clearLoopZone,
  toggleTrimsVisible,
  pendingTrimStart,
  loopZone,
}: UseTrimKeyboardShortcutsOptions): void {
  useEffect(() => {
    if (!enabled) return;

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
        // Mode shortcuts - clear selection on any mode change
        case "Digit1":
        case "KeyS":
          e.preventDefault();
          setBarMode('select');
          clearPendingTrim();
          clearLoopZone();
          break;
        case "Digit2":
        case "KeyT":
          e.preventDefault();
          setBarMode('trim');
          clearPendingTrim();
          clearLoopZone();
          break;
        case "Digit3":
        case "KeyM":
          e.preventDefault();
          setBarMode('marker');
          clearPendingTrim();
          clearLoopZone();
          break;
        // Toggle trims visibility
        case "KeyV":
          e.preventDefault();
          toggleTrimsVisible();
          break;
        // Escape clears pending trim and loop zone
        case "Escape":
          if (pendingTrimStart !== null || loopZone !== null) {
            e.preventDefault();
            clearPendingTrim();
            clearLoopZone();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, togglePlay, stepFrame, goToStart, setBarMode, clearPendingTrim, clearLoopZone, toggleTrimsVisible, pendingTrimStart, loopZone]);
}
