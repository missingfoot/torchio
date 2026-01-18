import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropZoneProps {
  onFilesDropped: (paths: string[]) => void;
  disabled?: boolean;
  fullScreen?: boolean;
}

interface DragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

export function DropZone({ onFilesDropped, disabled, fullScreen }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const validExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".gif"];

    const unlistenDrop = listen<DragDropPayload>("tauri://drag-drop", (event) => {
      setIsDragging(false);
      if (disabled) return;

      const validFiles = event.payload.paths.filter((path) => {
        const ext = path.toLowerCase().slice(path.lastIndexOf("."));
        return validExtensions.includes(ext);
      });

      if (validFiles.length > 0) {
        onFilesDropped(validFiles);
      }
    });

    const unlistenEnter = listen("tauri://drag-enter", () => {
      if (!disabled) setIsDragging(true);
    });

    const unlistenLeave = listen("tauri://drag-leave", () => {
      setIsDragging(false);
    });

    return () => {
      unlistenDrop.then((fn) => fn());
      unlistenEnter.then((fn) => fn());
      unlistenLeave.then((fn) => fn());
    };
  }, [onFilesDropped, disabled]);

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all duration-200",
        fullScreen ? "w-full max-w-md p-12" : "p-8",
        isDragging
          ? "border-primary bg-primary/10"
          : "border-muted-foreground/25 hover:border-muted-foreground/50",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <Upload
        className={cn(
          "mb-4 transition-colors",
          fullScreen ? "h-16 w-16" : "h-12 w-12",
          isDragging ? "text-primary" : "text-muted-foreground"
        )}
      />
      <p className={cn(
        "font-medium text-center",
        fullScreen ? "text-xl" : "text-lg"
      )}>
        {isDragging ? "Drop files here" : "Drag & drop files here"}
      </p>
      <p className="text-sm text-muted-foreground mt-2">
        Videos (MP4, MOV, AVI, MKV, WebM) or GIFs
      </p>
    </div>
  );
}
