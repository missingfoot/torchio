import { useState, useEffect } from "react";
import { Minus, Plus, ArrowLeft, X } from "lucide-react";
import { FileIcon } from "@untitledui/file-icons";
import { Button } from "./ui/button";
import { FileList } from "./FileList";
import { useExport } from "../contexts/ExportContext";
import { formatDuration } from "@/lib/utils";
import { getFormatsByCategory, type FormatConfig } from "@/lib/formats";

export function ExportPanel() {
  const [isClosing, setIsClosing] = useState(false);
  const {
    isOpen,
    closePanel,
    pendingExport,
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
  } = useExport();

  // Reset closing state when panel opens
  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
    }
  }, [isOpen]);

  // Size adjustment helpers from current format config
  const sizeIncrement = formatConfig?.sizeIncrement ?? 5;
  const sizeMin = formatConfig?.sizeMin ?? 5;
  const sizeMax = formatConfig?.sizeMax ?? 500;

  const adjustSize = (delta: number) => {
    setTargetMB(Math.max(sizeMin, Math.min(sizeMax, targetMB + delta)));
  };

  // Calculate export info from pending export
  const exportCount = pendingExport?.ranges.length ?? 0;
  const isFullVideo = exportCount === 1 && pendingExport?.ranges[0].startTime === 0;
  const totalExportDuration = pendingExport?.duration ?? 0;

  const handleFormatSelect = (format: FormatConfig) => {
    setSelectedFormat(format.id);
    setTargetMB(getTargetSize(format.id));
    setStep("size");
  };

  const handleBack = () => {
    if (step === "size") {
      setStep("format");
      setSelectedFormat(null);
    } else if (step === "format") {
      closePanel();
    }
  };

  const handleStartExport = async () => {
    await startExport();
  };

  // Check if we have active files (in progress or completed)
  const hasActiveFiles = files.length > 0;

  // Handle close with animation
  const handleClose = () => {
    setIsClosing(true);
  };

  // Actually close after animation
  const handleAnimationEnd = () => {
    if (isClosing) {
      setIsClosing(false);
      closePanel();
    }
  };

  // Don't render if closed
  if (!isOpen && !isClosing) return null;

  // When closing, only render the panel (not backdrop) to avoid blocking interactions
  const showBackdrop = isOpen && !isClosing;

  return (
    <>
      {/* Backdrop - hide during close animation to not block interactions */}
      {showBackdrop && (
        <div
          className="fixed inset-0 bg-black/50 z-[59]"
          onClick={handleClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed inset-y-0 right-0 w-[380px] bg-background border-l z-[60] flex flex-col ${isClosing ? "animate-slide-out-to-right" : "animate-slide-in-from-right"}`}
        onAnimationEnd={handleAnimationEnd}
      >
        {/* Header */}
        <div className="p-4 border-b flex items-center gap-3">
          {step !== "progress" && (
            <button
              onClick={handleBack}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              disabled={isExporting}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <span className="font-semibold flex-1">
            {step === "format" && "Export Format"}
            {step === "size" && "Target Size"}
            {step === "progress" && "Export Progress"}
          </span>
          <button
            onClick={handleClose}
            className="p-1.5 rounded hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === "format" && pendingExport && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="text-center text-sm text-muted-foreground">
                {isFullVideo ? (
                  <span>Full video ({formatDuration(totalExportDuration)})</span>
                ) : (
                  <span>
                    {exportCount} {exportCount === 1 ? "trim" : "trims"} ({formatDuration(totalExportDuration)} total)
                  </span>
                )}
              </div>

              {/* Format buttons - grouped by category */}
              {getFormatsByCategory().map(({ category, formats }) => (
                <div key={category.id} className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {category.name}
                  </div>
                  <div className="space-y-2">
                    {formats.map((format) => (
                      <button
                        key={format.id}
                        onClick={() => handleFormatSelect(format)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-input bg-transparent shadow-sm hover:bg-muted transition-colors text-left"
                      >
                        <FileIcon type={format.iconType} variant="solid" size={40} />
                        <div>
                          <div className="text-sm font-medium">{format.name}</div>
                          <div className="text-xs text-muted-foreground">{format.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === "size" && formatConfig && (
            <div className="space-y-6">
              {/* Summary for multiple trims */}
              {!isFullVideo && exportCount > 1 && (
                <div className="text-center text-sm text-muted-foreground">
                  Each trim will be a separate file
                </div>
              )}

              {/* Size control */}
              <div className="flex items-center justify-center gap-4 py-8">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 rounded-full shrink-0"
                  onClick={() => adjustSize(-sizeIncrement)}
                  disabled={targetMB <= sizeMin}
                >
                  <Minus className="h-5 w-5" />
                </Button>

                <div className="flex-1 text-center">
                  <div className="text-6xl font-bold tracking-tighter tabular-nums">
                    {sizeIncrement >= 1
                      ? targetMB
                      : targetMB.toFixed(1).replace(/\.0$/, "")}
                  </div>
                  <div className="text-muted-foreground text-sm uppercase tracking-wide mt-1">
                    MB {!isFullVideo && exportCount > 1 && "per file"}
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 rounded-full shrink-0"
                  onClick={() => adjustSize(sizeIncrement)}
                  disabled={targetMB >= sizeMax}
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
            </div>
          )}

          {step === "progress" && (
            <div className="space-y-4">
              {hasActiveFiles ? (
                <FileList files={files} onRemove={removeFile} />
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  No exports yet
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex gap-3">
          {step === "format" && (
            <Button variant="outline" className="flex-1" onClick={handleClose}>
              Cancel
            </Button>
          )}

          {step === "size" && (
            <>
              <Button variant="outline" className="flex-1" onClick={handleBack}>
                Back
              </Button>
              <Button className="flex-1" onClick={handleStartExport}>
                Export
              </Button>
            </>
          )}

          {step === "progress" && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleClose}
            >
              Close
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
