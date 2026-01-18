import { AlertCircle, X, Copy } from "lucide-react";
import { FileIcon } from "@untitledui/file-icons";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { cn, formatBytes } from "@/lib/utils";
import { getFormat } from "@/lib/formats";
import type { FileItem } from "../types";

function Spinner({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}>
      <g fill="currentColor">
        <g className="nc-loop-clock-anim-icon-f">
          <path d="M12,24A12,12,0,1,1,24,12,12.013,12.013,0,0,1,12,24ZM12,2A10,10,0,1,0,22,12,10.011,10.011,0,0,0,12,2Z" fill="currentColor"></path>
          <path d="M12,13a1,1,0,0,1-1-1V5a1,1,0,0,1,2,0v7A1,1,0,0,1,12,13Z" fill="currentColor"></path>
          <path d="M13,6v6a1,1,0,0,1-2,0V6a1,1,0,0,1,2,0Z" fill="currentColor"></path>
        </g>
        <style>{`.nc-loop-clock-anim-icon-f>*{--animation-duration:3s;transform-origin:50% 50%}.nc-loop-clock-anim-icon-f>:nth-last-child(2){animation:nc-loop-clock-anim-m calc(var(--animation-duration)/2) infinite linear}.nc-loop-clock-anim-icon-f>:nth-last-child(1){animation:nc-loop-clock-anim-h var(--animation-duration) infinite linear}@keyframes nc-loop-clock-anim-h{0%{transform:rotate(90deg)}100%{transform:rotate(450deg)}}@keyframes nc-loop-clock-anim-m{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}`}</style>
      </g>
    </svg>
  );
}

function CheckCircle({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}>
      <g fill="none">
        <path fillRule="evenodd" clipRule="evenodd" d="M12 1.25C6.06294 1.25 1.25 6.06294 1.25 12C1.25 17.9371 6.06294 22.75 12 22.75C17.9371 22.75 22.75 17.9371 22.75 12C22.75 6.06294 17.9371 1.25 12 1.25ZM7.53044 11.9697C7.23755 11.6768 6.76268 11.6768 6.46978 11.9697C6.17689 12.2626 6.17689 12.7374 6.46978 13.0303L9.46978 16.0303C9.76268 16.3232 10.2376 16.3232 10.5304 16.0303L17.5304 9.03033C17.8233 8.73744 17.8233 8.26256 17.5304 7.96967C17.2375 7.67678 16.7627 7.67678 16.4698 7.96967L10.0001 14.4393L7.53044 11.9697Z" fill="currentColor"></path>
      </g>
    </svg>
  );
}

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

  // Get format config for icon
  const formatConfig = getFormat(file.format);
  const iconType = formatConfig?.iconType ?? "video";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors",
        isComplete && "border-green-500/30 bg-green-500/5",
        isError && "border-destructive/30 bg-destructive/5"
      )}
    >
      <div className="flex-shrink-0">
        {isProcessing ? (
          <Spinner className="h-8 w-8 text-primary" />
        ) : isComplete ? (
          <CheckCircle className="h-8 w-8 text-green-500" />
        ) : (
          <FileIcon type={iconType} variant="solid" size={32} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{file.name}</p>
          {isError && <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />}
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
        className="flex-shrink-0 h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
        onClick={() => onRemove(file.id)}
        title={isProcessing ? "Cancel" : "Remove"}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
