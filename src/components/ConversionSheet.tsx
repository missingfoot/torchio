import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import { FileVideo, Image, Minus, Plus, ArrowLeft } from "lucide-react";
import type { ConversionType, TrimRange } from "../types";

interface ConversionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileCount: number;
  fileDuration?: number;
  onConvert: (type: ConversionType, targetMB: number, trimRanges?: TrimRange[]) => void;
  onNeedsTrim?: () => void;
  defaultVideoMB: number;
  defaultWebpMB: number;
  trimRanges?: TrimRange[];
}

type Step = "choose-type" | "choose-size";

const TRIM_THRESHOLD = 20; // seconds - show trim modal for videos longer than this

export function ConversionSheet({
  open,
  onOpenChange,
  fileCount,
  fileDuration,
  onConvert,
  onNeedsTrim,
  defaultVideoMB,
  defaultWebpMB,
  trimRanges = [],
}: ConversionSheetProps) {
  const hasTrimRanges = trimRanges.length > 0;
  const [step, setStep] = useState<Step>("choose-type");
  const [selectedType, setSelectedType] = useState<ConversionType | null>(null);
  const [targetMB, setTargetMB] = useState(40);

  // When returning from trim modal with trimRanges, go directly to size selection
  useEffect(() => {
    if (open && hasTrimRanges && !selectedType) {
      setSelectedType("webp");
      setTargetMB(defaultWebpMB);
      setStep("choose-size");
    }
  }, [open, hasTrimRanges, selectedType, defaultWebpMB]);

  const handleTypeSelect = (type: ConversionType) => {
    // For WebP with long videos, trigger trim flow
    if (type === "webp" && fileDuration && fileDuration > TRIM_THRESHOLD && onNeedsTrim && !hasTrimRanges) {
      setSelectedType(type);
      onNeedsTrim();
      return;
    }

    setSelectedType(type);
    setTargetMB(type === "video" ? defaultVideoMB : defaultWebpMB);
    setStep("choose-size");
  };

  const handleBack = () => {
    setStep("choose-type");
    setSelectedType(null);
  };

  const handleConvert = () => {
    if (selectedType) {
      onConvert(selectedType, targetMB, trimRanges.length > 0 ? trimRanges : undefined);
      onOpenChange(false);
      // Reset for next time
      setStep("choose-type");
      setSelectedType(null);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setStep("choose-type");
    setSelectedType(null);
  };

  const increment = selectedType === "video" ? 5 : 0.5;
  const min = selectedType === "video" ? 5 : 0.5;
  const max = selectedType === "video" ? 500 : 50;

  const adjustSize = (delta: number) => {
    setTargetMB((prev) => {
      const newVal = prev + delta;
      return Math.max(min, Math.min(max, newVal));
    });
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent onClose={handleClose}>
        {step === "choose-type" && (
          <>
            <SheetHeader>
              <SheetTitle>
                Convert {fileCount} {fileCount === 1 ? "file" : "files"}
              </SheetTitle>
            </SheetHeader>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => handleTypeSelect("video")}
                className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 border-muted hover:border-blue-500 hover:bg-blue-500/10 transition-all"
              >
                <FileVideo className="h-12 w-12 text-blue-400" />
                <div className="text-center">
                  <div className="font-semibold">Video</div>
                  <div className="text-xs text-muted-foreground">MP4 output</div>
                </div>
              </button>

              <button
                onClick={() => handleTypeSelect("webp")}
                className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 border-muted hover:border-purple-500 hover:bg-purple-500/10 transition-all"
              >
                <Image className="h-12 w-12 text-purple-400" />
                <div className="text-center">
                  <div className="font-semibold">WebP</div>
                  <div className="text-xs text-muted-foreground">Animated image</div>
                </div>
              </button>
            </div>
          </>
        )}

        {step === "choose-size" && selectedType && (
          <>
            <SheetHeader>
              <button
                onClick={handleBack}
                className="absolute left-4 top-6 p-1 rounded hover:bg-muted transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <SheetTitle>Target file size</SheetTitle>
            </SheetHeader>

            <div className="flex items-center justify-center space-x-4 py-8">
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 rounded-full shrink-0"
                onClick={() => adjustSize(-increment)}
                disabled={targetMB <= min}
              >
                <Minus className="h-5 w-5" />
              </Button>

              <div className="flex-1 text-center">
                <div className="text-7xl font-bold tracking-tighter tabular-nums">
                  {selectedType === "video"
                    ? targetMB
                    : targetMB.toFixed(1).replace(/\.0$/, "")}
                </div>
                <div className="text-muted-foreground text-sm uppercase tracking-wide">
                  MB
                </div>
              </div>

              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 rounded-full shrink-0"
                onClick={() => adjustSize(increment)}
                disabled={targetMB >= max}
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>

            <Button
              className="w-full mt-4"
              size="lg"
              onClick={handleConvert}
            >
              Convert to {selectedType === "video" ? "MP4" : "WebP"}
            </Button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
