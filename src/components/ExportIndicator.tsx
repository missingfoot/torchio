import { Check } from "lucide-react";
import { useExport } from "../contexts/ExportContext";

export function ExportIndicator() {
  const { files, isExporting, showProgress } = useExport();

  // Don't show if no files
  if (files.length === 0) return null;

  // Calculate overall progress
  const totalProgress = files.reduce((sum, f) => sum + f.progress, 0);
  const avgProgress = Math.round(totalProgress / files.length);

  // Count completed and total
  const completedCount = files.filter(f => f.status === "completed").length;
  const allCompleted = completedCount === files.length;

  return (
    <button
      onClick={showProgress}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 bg-card border rounded-full shadow-lg hover:bg-muted transition-colors"
    >
      {isExporting ? (
        <>
          {/* Dots animation */}
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <g fill="currentColor">
              <g className="nc-loop-dots-4-24-icon-f">
                <circle cx="4" cy="12" fill="currentColor" r="3"></circle>
                <circle cx="12" cy="12" fill="currentColor" r="3"></circle>
                <circle cx="20" cy="12" fill="currentColor" r="3"></circle>
              </g>
              <style>{`.nc-loop-dots-4-24-icon-f{--animation-duration:0.8s}.nc-loop-dots-4-24-icon-f *{opacity:.4;transform:scale(.75);animation:nc-loop-dots-4-anim var(--animation-duration) infinite}.nc-loop-dots-4-24-icon-f :nth-child(1){transform-origin:4px 12px;animation-delay:-.3s;animation-delay:calc(var(--animation-duration)/-2.666)}.nc-loop-dots-4-24-icon-f :nth-child(2){transform-origin:12px 12px;animation-delay:-.15s;animation-delay:calc(var(--animation-duration)/-5.333)}.nc-loop-dots-4-24-icon-f :nth-child(3){transform-origin:20px 12px}@keyframes nc-loop-dots-4-anim{0%,100%{opacity:.4;transform:scale(.75)}50%{opacity:1;transform:scale(1)}}`}</style>
            </g>
          </svg>
          <span className="text-sm font-medium">Exporting</span>
          {/* Progress bar */}
          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${avgProgress}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{avgProgress}%</span>
        </>
      ) : allCompleted ? (
        <>
          <Check className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium">
            {completedCount} {completedCount === 1 ? "export" : "exports"} complete
          </span>
        </>
      ) : (
        <>
          <span className="text-sm font-medium">
            {completedCount}/{files.length} exports
          </span>
        </>
      )}
    </button>
  );
}
