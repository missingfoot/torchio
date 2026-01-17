import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DropZone } from "./components/DropZone";
import { FileList } from "./components/FileList";
import { ConversionSheet } from "./components/ConversionSheet";
import { TrimModal } from "./components/TrimModal";
import { useSettings } from "./hooks/useSettings";
import { parseMBtoBytes } from "./lib/utils";
import type { FileItem, ConversionType, ConversionResult, TrimRange } from "./types";

interface ProgressPayload {
  id: string;
  progress: number;
  status: string;
}

interface PendingFile {
  path: string;
  name: string;
  size: number;
}

function App() {
  const { settings, updateSettings, loaded } = useSettings();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isConverting, setIsConverting] = useState(false);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [pendingDuration, setPendingDuration] = useState<number | undefined>();

  // Trim modal state
  const [trimModalOpen, setTrimModalOpen] = useState(false);
  const [trimRanges, setTrimRanges] = useState<TrimRange[]>([]);

  // Listen for progress events from Rust
  useEffect(() => {
    const unlisten = listen<ProgressPayload>("conversion-progress", (event) => {
      const { id, progress, status } = event.payload;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, progress, status: status as FileItem["status"] }
            : f
        )
      );
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

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
      setTrimRanges([]);

      // Try to get duration for the first file (for trim modal decision)
      try {
        const duration = await invoke<number>("get_video_duration", { path: filesInfo[0].path });
        setPendingDuration(duration);
      } catch {
        setPendingDuration(undefined);
      }

      setSheetOpen(true);
    }
  }, []);

  const handleNeedsTrim = useCallback(() => {
    setSheetOpen(false);
    setTrimModalOpen(true);
  }, []);

  const handleTrimConfirm = useCallback((ranges: TrimRange[]) => {
    setTrimRanges(ranges);
    setTrimModalOpen(false);
    setSheetOpen(true);
  }, []);

  const handleTrimCancel = useCallback(() => {
    setTrimModalOpen(false);
    setSheetOpen(true);
  }, []);

  const handleConvert = useCallback(async (type: ConversionType, targetMB: number, trimRangesArg?: TrimRange[]) => {
    // Save the target for next time
    if (type === "video") {
      updateSettings({ videoTargetMB: targetMB });
    } else {
      updateSettings({ webpTargetMB: targetMB });
    }

    const targetBytes = parseMBtoBytes(targetMB);

    // Calculate trim parameters if provided (use first trim for now)
    const firstTrim = trimRangesArg && trimRangesArg.length > 0 ? trimRangesArg[0] : undefined;
    const trimStart = firstTrim?.startTime;
    const trimDuration = firstTrim ? firstTrim.endTime - firstTrim.startTime : undefined;

    // Create file items from pending files
    const newFiles: FileItem[] = pendingFiles.map((pf) => ({
      id: crypto.randomUUID(),
      name: pf.name,
      path: pf.path,
      size: pf.size,
      type,
      status: "pending" as const,
      progress: 0,
    }));

    setFiles((prev) => [...prev, ...newFiles]);
    setPendingFiles([]);
    setTrimRanges([]);
    setIsConverting(true);

    // Convert each file
    for (const file of newFiles) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === file.id ? { ...f, status: "analyzing", progress: 0 } : f
        )
      );

      try {
        const result = await invoke<ConversionResult>("convert_file", {
          id: file.id,
          inputPath: file.path,
          targetBytes,
          conversionType: type,
          trimStart,
          trimDuration,
        });

        setFiles((prev) =>
          prev.map((f) =>
            f.id === file.id
              ? {
                  ...f,
                  status: result.success ? "completed" : "error",
                  progress: 100,
                  outputPath: result.outputPath,
                  outputSize: result.outputSize,
                  error: result.error,
                }
              : f
          )
        );
      } catch (e) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === file.id
              ? {
                  ...f,
                  status: "error",
                  error: String(e),
                }
              : f
          )
        );
      }
    }

    setIsConverting(false);
  }, [pendingFiles, updateSettings]);

  const handleRemove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
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
      <div className="flex-1 flex flex-col gap-4">
        <DropZone onFilesDropped={handleFilesDropped} disabled={isConverting} />
        <FileList files={files} onRemove={handleRemove} />
      </div>

      <ConversionSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        fileCount={pendingFiles.length}
        fileDuration={pendingDuration}
        onConvert={handleConvert}
        onNeedsTrim={handleNeedsTrim}
        defaultVideoMB={settings.videoTargetMB}
        defaultWebpMB={settings.webpTargetMB}
        trimRanges={trimRanges}
      />

      {pendingFiles.length > 0 && (
        <TrimModal
          open={trimModalOpen}
          onOpenChange={setTrimModalOpen}
          filePath={pendingFiles[0].path}
          fileName={pendingFiles[0].name}
          onConfirm={handleTrimConfirm}
          onCancel={handleTrimCancel}
        />
      )}
    </div>
  );
}

export default App;
