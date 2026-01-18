import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "../hooks/useSettings";
import { parseMBtoBytes } from "../lib/utils";
import { getFormat, type FormatConfig } from "../lib/formats";
import type { FileItem, FormatId, ConversionResult, PendingExport, ExportStep } from "../types";

interface ProgressPayload {
  id: string;
  progress: number;
  status: string;
}

interface ExportContextValue {
  // Panel visibility
  isOpen: boolean;
  openPanel: (pendingExport: PendingExport) => void;
  showProgress: () => void;
  closePanel: () => void;

  // Current pending export (format/size selection phase)
  pendingExport: PendingExport | null;

  // Export configuration
  selectedFormat: FormatId | null;
  setSelectedFormat: (format: FormatId | null) => void;
  formatConfig: FormatConfig | null;
  targetMB: number;
  setTargetMB: (mb: number) => void;

  // Step management
  step: ExportStep;
  setStep: (step: ExportStep) => void;

  // Active exports (files being converted)
  files: FileItem[];
  isExporting: boolean;
  startExport: () => Promise<void>;
  removeFile: (id: string) => void;

  // Settings helpers
  getTargetSize: (formatId: FormatId) => number;
}

const ExportContext = createContext<ExportContextValue | null>(null);

export function useExport() {
  const context = useContext(ExportContext);
  if (!context) {
    throw new Error("useExport must be used within an ExportProvider");
  }
  return context;
}

interface ExportProviderProps {
  children: ReactNode;
}

export function ExportProvider({ children }: ExportProviderProps) {
  const { updateTargetSize, getTargetSize } = useSettings();

  // Panel state
  const [isOpen, setIsOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(null);

  // Export configuration
  const [selectedFormat, setSelectedFormat] = useState<FormatId | null>(null);
  const [targetMB, setTargetMB] = useState(25); // Will be set when format is selected
  const [step, setStep] = useState<ExportStep>("format");

  // Get current format config
  const formatConfig = selectedFormat ? getFormat(selectedFormat) ?? null : null;

  // Active exports
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isExporting, setIsExporting] = useState(false);

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

  const openPanel = useCallback((pending: PendingExport) => {
    setPendingExport(pending);
    setSelectedFormat(null);
    setTargetMB(25); // Will be updated when format is selected
    setStep("format");
    setIsOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    // Allow closing at any time - export continues in background
    setIsOpen(false);
  }, []);

  const showProgress = useCallback(() => {
    // Open panel directly to progress step (for viewing exports)
    setStep("progress");
    setIsOpen(true);
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const startExport = useCallback(async () => {
    if (!selectedFormat || !pendingExport || !formatConfig) return;

    // Save the target for next time
    updateTargetSize(selectedFormat, targetMB);

    const targetBytes = parseMBtoBytes(targetMB);

    setIsExporting(true);
    setStep("progress");

    // Get the base name without extension
    const lastDot = pendingExport.sourceName.lastIndexOf(".");
    const baseName = lastDot > 0 ? pendingExport.sourceName.substring(0, lastDot) : pendingExport.sourceName;
    const ext = formatConfig.extension;

    // Create a file item for each range
    const newFiles: FileItem[] = pendingExport.ranges.map((range, index) => {
      const suffix = pendingExport.ranges.length > 1 ? `_trim${index + 1}` : "";
      return {
        id: crypto.randomUUID(),
        name: `${baseName}${suffix}.${ext}`,
        path: pendingExport.sourcePath,
        size: pendingExport.sourceSize,
        format: selectedFormat,
        status: "pending" as const,
        progress: 0,
        trimStart: range.startTime,
        trimDuration: range.endTime - range.startTime,
      };
    });

    setFiles((prev) => [...prev, ...newFiles]);

    // Convert each file (each range)
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
          outputName: file.name,
          targetBytes,
          conversionType: selectedFormat,
          trimStart: file.trimStart,
          trimDuration: file.trimDuration,
          markers: pendingExport.markers,  // Pass markers for MKV chapter export
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

    setIsExporting(false);
    // Clear pending export after completion
    setPendingExport(null);
  }, [selectedFormat, pendingExport, targetMB, formatConfig, updateTargetSize]);

  const value: ExportContextValue = {
    isOpen,
    openPanel,
    showProgress,
    closePanel,
    pendingExport,
    selectedFormat,
    setSelectedFormat,
    formatConfig,
    targetMB,
    setTargetMB,
    step,
    setStep,
    files,
    isExporting,
    startExport,
    removeFile,
    getTargetSize,
  };

  return (
    <ExportContext.Provider value={value}>
      {children}
    </ExportContext.Provider>
  );
}
