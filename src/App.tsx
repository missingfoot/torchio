import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DropZone } from "./components/DropZone";
import { TrimModal } from "./components/TrimModal";
import { ExportPanel } from "./components/ExportPanel";
import { ExportIndicator } from "./components/ExportIndicator";
import { ExportProvider } from "./contexts/ExportContext";
import { useSettings } from "./hooks/useSettings";

interface PendingFile {
  path: string;
  name: string;
  size: number;
}

function AppContent() {
  const { loaded } = useSettings();

  // Pending file state
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

  // Trim modal state
  const [trimModalOpen, setTrimModalOpen] = useState(false);

  // New flow: drop → TrimModal immediately
  const handleFilesDropped = useCallback(async (paths: string[]) => {
    // Get file info for dropped files
    const filesInfo: PendingFile[] = [];

    for (const path of paths) {
      try {
        const size = await invoke<number>("get_file_size", { path });
        const name = path.split(/[/\\]/).pop() || path;
        filesInfo.push({ path, name, size });
      } catch (e) {
        console.error("Failed to get file info:", e);
      }
    }

    if (filesInfo.length > 0) {
      setPendingFiles(filesInfo);
      // Open trim modal immediately
      setTrimModalOpen(true);
    }
  }, []);

  const handleTrimCancel = useCallback(() => {
    setTrimModalOpen(false);
    setPendingFiles([]);
  }, []);

  const handleTrimComplete = useCallback(() => {
    // Called after export panel is opened
    // Keep modal open - user can go back to adjust trims
  }, []);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col p-4">
      {/* Full-screen drop zone */}
      <div className="flex-1 flex items-center justify-center">
        <DropZone onFilesDropped={handleFilesDropped} fullScreen />
      </div>

      {/* Trim modal */}
      {pendingFiles.length > 0 && (
        <TrimModal
          open={trimModalOpen}
          onOpenChange={setTrimModalOpen}
          filePath={pendingFiles[0].path}
          fileName={pendingFiles[0].name}
          fileSize={pendingFiles[0].size}
          onCancel={handleTrimCancel}
          onExportStarted={handleTrimComplete}
        />
      )}

      {/* Universal export panel - highest z-layer */}
      <ExportPanel />

      {/* Bottom progress indicator - like Steam's download indicator */}
      <ExportIndicator />
    </div>
  );
}

function App() {
  return (
    <ExportProvider>
      <AppContent />
    </ExportProvider>
  );
}

export default App;
