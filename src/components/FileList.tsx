import { FileVideo, Image, Check, AlertCircle, Loader2, X, Copy } from "lucide-react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { cn, formatBytes } from "@/lib/utils";
import type { FileItem } from "../types";

interface FileListProps {
  files: FileItem[];
  onRemove: (id: string) => void;
}

export function FileList({ files, onRemove }: FileListProps) {
  if (files.length === 0) return null;

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <FileRow key={file.id} file={file} onRemove={onRemove} />
      ))}
    </div>
  );
}

function FileRow({
  file,
  onRemove,
}: {
  file: FileItem;
  onRemove: (id: string) => void;
}) {
  const isProcessing = file.status === "analyzing" || file.status === "converting";
  const isComplete = file.status === "completed";
  const isError = file.status === "error";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors",
        isComplete && "border-green-500/30 bg-green-500/5",
        isError && "border-destructive/30 bg-destructive/5"
      )}
    >
      <div className="flex-shrink-0">
        {file.type === "video" ? (
          <FileVideo className="h-8 w-8 text-blue-400" />
        ) : (
          <Image className="h-8 w-8 text-purple-400" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{file.name}</p>
          {isComplete && <Check className="h-4 w-4 text-green-500 flex-shrink-0" />}
          {isError && <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />}
          {isProcessing && (
            <Loader2 className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
          )}
        </div>

        <div className="text-xs text-muted-foreground mt-1">
          <span>{formatBytes(file.size)}</span>
          {isComplete && file.outputSize && (
            <>
              <span> → </span>
              <span className="text-green-400">{formatBytes(file.outputSize)}</span>
              <span className="text-green-400">
                {" "}({Math.round((1 - file.outputSize / file.size) * 100)}% smaller)
              </span>
            </>
          )}
        </div>
        {isError && file.error && (
          <div className="relative text-xs text-destructive mt-2 p-2 bg-destructive/10 rounded break-all whitespace-pre-wrap">
            <button
              onClick={() => navigator.clipboard.writeText(file.error || "")}
              className="absolute top-1 right-1 p-1 hover:bg-destructive/20 rounded"
              title="Copy error"
            >
              <Copy className="h-3 w-3" />
            </button>
            {file.error}
          </div>
        )}

        {isProcessing && (
          <Progress value={file.progress} className="mt-2 h-1" />
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="flex-shrink-0 h-8 w-8"
        onClick={() => onRemove(file.id)}
        disabled={isProcessing}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
