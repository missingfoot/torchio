import { useRef, useCallback } from "react";
import type { Trim } from "@/types";

interface TrimColor {
  name: string;
  border: string;
  bg: string;
  dot: string;
  text: string;
}

type BarMode = 'select' | 'trim' | 'marker';

interface TrimBarProps {
  duration: number;
  trims: Trim[];
  trimsVisible: boolean;
  onTrimUpdate: (id: number, startTime: number, endTime: number) => void;
  onHover?: (time: number | null) => void;
  lockedTimes?: number[];
  filmstrip?: string[];
  currentTime?: number;
  colors: TrimColor[];
  // Mode-specific props
  mode: BarMode;
  pendingTrimStart: number | null;
  pendingTrimEnd: number | null; // Set during drag to show live trim preview
  onSeek: (time: number) => void;
  onTrimCreate: (startTime: number, endTime: number) => void;
  onMarkerAdd: (time: number) => void;
  onPendingTrimChange: (time: number | null) => void;
  onPendingTrimEndChange: (time: number | null) => void;
  // Loop zone props (seek mode)
  loopZone: { start: number; end: number } | null;
  onLoopZoneChange: (zone: { start: number; end: number } | null) => void;
  // Playhead lock (seek mode - click to lock/unlock hover following)
  playheadLocked: boolean;
  onPlayheadLockChange: (locked: boolean) => void;
}

export function TrimBar({
  duration,
  trims,
  trimsVisible,
  onTrimUpdate,
  onHover,
  lockedTimes = [],
  filmstrip = [],
  currentTime,
  colors,
  mode,
  pendingTrimStart,
  pendingTrimEnd,
  onSeek,
  onTrimCreate,
  onMarkerAdd,
  onPendingTrimChange,
  onPendingTrimEndChange,
  loopZone,
  onLoopZoneChange,
  playheadLocked,
  onPlayheadLockChange,
}: TrimBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const isClickingRef = useRef(false); // Prevent hover from overwriting click

  const getTimeFromPosition = useCallback(
    (clientX: number) => {
      if (!barRef.current) return 0;
      const rect = barRef.current.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return percent * duration;
    },
    [duration]
  );

  // Handle dragging the start handle of a trim
  const handleStartDrag = useCallback(
    (e: React.MouseEvent, trim: Trim) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      const handleMouseMove = (ev: MouseEvent) => {
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        const time = getTimeFromPosition(ev.clientX);
        const maxStart = trim.endTime - 1;
        let newStart = Math.max(0, Math.min(time, maxStart));

        // Snap to nearest locked time (5px threshold)
        const snapPixels = 5;
        const snapThreshold = (snapPixels / rect.width) * duration;
        for (const lt of lockedTimes) {
          if (Math.abs(newStart - lt) < snapThreshold) {
            newStart = lt;
            break;
          }
        }

        onTrimUpdate(trim.id, newStart, trim.endTime);
        onHover?.(newStart);
      };
      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setTimeout(() => { isDraggingRef.current = false; }, 0);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [getTimeFromPosition, onTrimUpdate, onHover, duration, lockedTimes]
  );

  // Handle dragging the end handle of a trim
  const handleEndDrag = useCallback(
    (e: React.MouseEvent, trim: Trim) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;
      const handleMouseMove = (ev: MouseEvent) => {
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        const time = getTimeFromPosition(ev.clientX);
        const minEnd = trim.startTime + 1;
        let newEnd = Math.max(minEnd, Math.min(time, duration));

        // Snap to nearest locked time (5px threshold)
        const snapPixels = 5;
        const snapThreshold = (snapPixels / rect.width) * duration;
        for (const lt of lockedTimes) {
          if (Math.abs(newEnd - lt) < snapThreshold) {
            newEnd = lt;
            break;
          }
        }

        onTrimUpdate(trim.id, trim.startTime, newEnd);
        onHover?.(newEnd);
      };
      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setTimeout(() => { isDraggingRef.current = false; }, 0);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [getTimeFromPosition, duration, onTrimUpdate, onHover, lockedTimes]
  );

  // Drag the entire trim region
  const handleRegionDrag = useCallback(
    (e: React.MouseEvent, trim: Trim) => {
      e.preventDefault();
      isDraggingRef.current = true;
      const startX = e.clientX;
      const initialStart = trim.startTime;
      const initialEnd = trim.endTime;
      const trimDuration = trim.endTime - trim.startTime;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        const deltaX = ev.clientX - startX;
        const deltaTime = (deltaX / rect.width) * duration;

        let newStart = initialStart + deltaTime;
        let newEnd = initialEnd + deltaTime;

        // Clamp to bounds
        if (newStart < 0) {
          newStart = 0;
          newEnd = trimDuration;
        }
        if (newEnd > duration) {
          newEnd = duration;
          newStart = duration - trimDuration;
        }

        // Snap to nearest locked time (5px threshold)
        const snapPixels = 5;
        const snapThreshold = (snapPixels / rect.width) * duration;
        for (const lt of lockedTimes) {
          if (Math.abs(newStart - lt) < snapThreshold) {
            newStart = lt;
            newEnd = lt + trimDuration;
            break;
          } else if (Math.abs(newEnd - lt) < snapThreshold) {
            newEnd = lt;
            newStart = lt - trimDuration;
            break;
          }
        }

        onTrimUpdate(trim.id, newStart, newEnd);
        onHover?.(newStart);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setTimeout(() => { isDraggingRef.current = false; }, 0);
      };
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [duration, lockedTimes, onTrimUpdate, onHover]
  );

  // Handle dragging the start handle of loop zone
  const handleLoopZoneStartDrag = useCallback(
    (e: React.MouseEvent) => {
      if (!loopZone) return;
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;

      const handleMouseMove = (ev: MouseEvent) => {
        const time = getTimeFromPosition(ev.clientX);
        const maxStart = loopZone.end - 0.3; // Min 0.3s zone
        const newStart = Math.max(0, Math.min(time, maxStart));
        onLoopZoneChange({ start: newStart, end: loopZone.end });
        onSeek(newStart);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setTimeout(() => { isDraggingRef.current = false; }, 0);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [loopZone, getTimeFromPosition, onLoopZoneChange, onSeek]
  );

  // Handle dragging the end handle of loop zone
  const handleLoopZoneEndDrag = useCallback(
    (e: React.MouseEvent) => {
      if (!loopZone) return;
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;

      const handleMouseMove = (ev: MouseEvent) => {
        const time = getTimeFromPosition(ev.clientX);
        const minEnd = loopZone.start + 0.3; // Min 0.3s zone
        const newEnd = Math.max(minEnd, Math.min(time, duration));
        onLoopZoneChange({ start: loopZone.start, end: newEnd });
        onSeek(newEnd);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setTimeout(() => { isDraggingRef.current = false; }, 0);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [loopZone, getTimeFromPosition, duration, onLoopZoneChange, onSeek]
  );

  // Handle dragging the entire loop zone region
  const handleLoopZoneRegionDrag = useCallback(
    (e: React.MouseEvent) => {
      if (!loopZone) return;
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;

      const startX = e.clientX;
      const initialStart = loopZone.start;
      const initialEnd = loopZone.end;
      const zoneDuration = loopZone.end - loopZone.start;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        const deltaX = ev.clientX - startX;
        const deltaTime = (deltaX / rect.width) * duration;

        let newStart = initialStart + deltaTime;
        let newEnd = initialEnd + deltaTime;

        // Clamp to bounds
        if (newStart < 0) {
          newStart = 0;
          newEnd = zoneDuration;
        }
        if (newEnd > duration) {
          newEnd = duration;
          newStart = duration - zoneDuration;
        }

        onLoopZoneChange({ start: newStart, end: newEnd });
        onSeek(newStart);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setTimeout(() => { isDraggingRef.current = false; }, 0);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [loopZone, duration, onLoopZoneChange, onSeek]
  );

  // Handle mousedown on the bar for mode-specific behavior
  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Don't interfere with trim handle/region drags
      if (isDraggingRef.current) return;

      const time = getTimeFromPosition(e.clientX);

      switch (mode) {
        case 'select':
          // If loop zone exists, clicking clears it and seeks (but doesn't lock)
          if (loopZone) {
            onLoopZoneChange(null);
            onSeek(time);
            // Don't lock - hover following resumes
            isDraggingRef.current = false;
            return;
          }

          // Set clicking flag to prevent hover interference
          isClickingRef.current = true;
          onSeek(time);

          // Set up drag to scrub and create loop zone live
          isDraggingRef.current = true;
          const seekStartTime = time;
          let seekHasMoved = false;

          const handleSeekMove = (ev: MouseEvent) => {
            seekHasMoved = true;
            const currentT = getTimeFromPosition(ev.clientX);
            onSeek(currentT);

            // Update loop zone live as user drags
            const start = Math.min(seekStartTime, currentT);
            const end = Math.max(seekStartTime, currentT);
            if (end - start >= 0.1) { // Show zone once there's some distance
              onLoopZoneChange({ start, end });
            }
          };
          const handleSeekUp = (ev: MouseEvent) => {
            document.removeEventListener('mousemove', handleSeekMove);
            document.removeEventListener('mouseup', handleSeekUp);

            // Clear dragging state
            setTimeout(() => {
              isDraggingRef.current = false;
              isClickingRef.current = false;
            }, 50);

            if (seekHasMoved) {
              // Dragged - finalize the loop zone, clear if too small
              const endTime = getTimeFromPosition(ev.clientX);
              const start = Math.min(seekStartTime, endTime);
              const end = Math.max(seekStartTime, endTime);
              if (end - start < 0.3) {
                onLoopZoneChange(null);
              }
              // Don't lock playhead after drag - keep hover following
            } else {
              // Single click (no drag) - toggle playhead lock
              onPlayheadLockChange(!playheadLocked);
            }
          };
          document.addEventListener('mousemove', handleSeekMove);
          document.addEventListener('mouseup', handleSeekUp);
          break;

        case 'trim':
          if (pendingTrimStart === null) {
            // First click - set start point
            onPendingTrimChange(time);
            onSeek(time);
            // Set up drag to create trim with live preview
            isDraggingRef.current = true;
            const trimStartTime = time;
            let trimHasMoved = false;

            const handleTrimMove = (ev: MouseEvent) => {
              trimHasMoved = true;
              const currentT = getTimeFromPosition(ev.clientX);
              onSeek(currentT);
              // Update pending trim end to show live solid preview
              onPendingTrimEndChange(currentT);
            };

            const handleTrimUp = (ev: MouseEvent) => {
              document.removeEventListener('mousemove', handleTrimMove);
              document.removeEventListener('mouseup', handleTrimUp);
              setTimeout(() => { isDraggingRef.current = false; }, 0);

              if (trimHasMoved) {
                // Drag completed - create trim
                const endTime = getTimeFromPosition(ev.clientX);
                const start = Math.min(trimStartTime, endTime);
                const end = Math.max(trimStartTime, endTime);
                if (end - start >= 0.5) {
                  onTrimCreate(start, end);
                }
                onPendingTrimChange(null);
                onPendingTrimEndChange(null);
              }
              // If no movement, keep the pending start for second click (dotted line)
            };

            document.addEventListener('mousemove', handleTrimMove);
            document.addEventListener('mouseup', handleTrimUp);
          } else {
            // Second click - complete the trim
            const start = Math.min(pendingTrimStart, time);
            const end = Math.max(pendingTrimStart, time);
            if (end - start >= 0.5) {
              onTrimCreate(start, end);
            }
            onPendingTrimChange(null);
            onPendingTrimEndChange(null);
          }
          break;

        case 'marker':
          onMarkerAdd(time);
          break;
      }
    },
    [mode, pendingTrimStart, getTimeFromPosition, onSeek, onTrimCreate, onMarkerAdd, onPendingTrimChange, onPendingTrimEndChange, loopZone, onLoopZoneChange, playheadLocked, onPlayheadLockChange]
  );

  // Calculate dimmed regions (areas outside all trims or loop zone)
  const getDimmedRegions = () => {
    // If loop zone is active, dim outside the loop zone
    if (loopZone) {
      const regions: { left: number; width: number }[] = [];

      if (loopZone.start > 0) {
        regions.push({
          left: 0,
          width: (loopZone.start / duration) * 100,
        });
      }

      if (loopZone.end < duration) {
        regions.push({
          left: (loopZone.end / duration) * 100,
          width: ((duration - loopZone.end) / duration) * 100,
        });
      }

      return regions;
    }

    // Otherwise, dim outside trims (existing behavior)
    if (!trimsVisible || trims.length === 0) return [];

    // Sort trims by start time
    const sortedTrims = [...trims].sort((a, b) => a.startTime - b.startTime);
    const regions: { left: number; width: number }[] = [];

    // Region before first trim
    if (sortedTrims[0].startTime > 0) {
      regions.push({
        left: 0,
        width: (sortedTrims[0].startTime / duration) * 100,
      });
    }

    // Regions between trims
    for (let i = 0; i < sortedTrims.length - 1; i++) {
      const currentEnd = sortedTrims[i].endTime;
      const nextStart = sortedTrims[i + 1].startTime;
      if (nextStart > currentEnd) {
        regions.push({
          left: (currentEnd / duration) * 100,
          width: ((nextStart - currentEnd) / duration) * 100,
        });
      }
    }

    // Region after last trim
    const lastTrim = sortedTrims[sortedTrims.length - 1];
    if (lastTrim.endTime < duration) {
      regions.push({
        left: (lastTrim.endTime / duration) * 100,
        width: ((duration - lastTrim.endTime) / duration) * 100,
      });
    }

    return regions;
  };

  const dimmedRegions = getDimmedRegions();

  // Default cursor for accuracy
  const cursorClass = 'cursor-default';

  return (
    <div
      ref={barRef}
      className={`relative h-16 bg-muted overflow-hidden select-none ${cursorClass}`}
      onMouseMove={(e) => {
        if (onHover && !isDraggingRef.current && !isClickingRef.current) {
          const time = getTimeFromPosition(e.clientX);
          onHover(time);
        }
      }}
      onMouseLeave={() => onHover?.(null)}
      onMouseDown={handleBarMouseDown}
    >
      {/* Filmstrip background */}
      {filmstrip.length > 0 && (
        <div className="absolute inset-0 flex">
          {filmstrip.map((frame, i) => (
            <div
              key={i}
              className="flex-1 bg-cover bg-center"
              style={{ backgroundImage: frame ? `url(${frame})` : undefined }}
            />
          ))}
        </div>
      )}

      {/* Dimmed regions outside all trims */}
      {dimmedRegions.map((region, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 bg-black/70"
          style={{ left: `${region.left}%`, width: `${region.width}%` }}
        />
      ))}

      {/* Render each trim region */}
      {trimsVisible && trims.map((trim) => {
        const color = colors[trim.colorIndex];
        const startPercent = (trim.startTime / duration) * 100;
        const endPercent = (trim.endTime / duration) * 100;

        return (
          <div key={trim.id}>
            {/* Trim region - draggable area */}
            <div
              className={`absolute top-0 bottom-0 border ${color.border} ${color.bg} cursor-move`}
              style={{
                left: `${startPercent}%`,
                width: `${endPercent - startPercent}%`,
              }}
              onMouseDown={(e) => handleRegionDrag(e, trim)}
            />

            {/* Start handle */}
            <div
              className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center"
              style={{ left: `calc(${startPercent}% - 6px)` }}
              onMouseDown={(e) => handleStartDrag(e, trim)}
            >
              <div className={`w-0.5 h-8 ${color.dot} rounded-full`} />
            </div>

            {/* End handle */}
            <div
              className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center"
              style={{ left: `calc(${endPercent}% - 6px)` }}
              onMouseDown={(e) => handleEndDrag(e, trim)}
            >
              <div className={`w-0.5 h-8 ${color.dot} rounded-full`} />
            </div>
          </div>
        );
      })}

      {/* Locked position indicators */}
      {lockedTimes.map((lt, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none"
          style={{ left: `${(lt / duration) * 100}%` }}
        />
      ))}

      {/* Loop zone indicator (styled like a trim but blue) */}
      {loopZone && (() => {
        const startPercent = (loopZone.start / duration) * 100;
        const endPercent = (loopZone.end / duration) * 100;
        return (
          <>
            {/* Loop zone region - draggable */}
            <div
              className="absolute top-0 bottom-0 border border-blue-400 cursor-move"
              style={{
                left: `${startPercent}%`,
                width: `${endPercent - startPercent}%`,
              }}
              onMouseDown={handleLoopZoneRegionDrag}
            />

            {/* Start handle */}
            <div
              className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center"
              style={{ left: `calc(${startPercent}% - 6px)` }}
              onMouseDown={handleLoopZoneStartDrag}
            >
              <div className="w-0.5 h-8 bg-blue-400 rounded-full" />
            </div>

            {/* End handle */}
            <div
              className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center"
              style={{ left: `calc(${endPercent}% - 6px)` }}
              onMouseDown={handleLoopZoneEndDrag}
            >
              <div className="w-0.5 h-8 bg-blue-400 rounded-full" />
            </div>
          </>
        );
      })()}

      {/* Pending trim preview */}
      {pendingTrimStart !== null && (() => {
        // Get the color for the next trim
        const nextColor = colors[trims.length % colors.length];

        // If pendingTrimEnd is set, we're dragging - show solid trim preview
        if (pendingTrimEnd !== null) {
          const start = Math.min(pendingTrimStart, pendingTrimEnd);
          const end = Math.max(pendingTrimStart, pendingTrimEnd);
          const startPercent = (start / duration) * 100;
          const endPercent = (end / duration) * 100;

          return (
            <>
              {/* Solid trim preview (like real trim) */}
              <div
                className={`absolute top-0 bottom-0 border ${nextColor.border} ${nextColor.bg} z-15 pointer-events-none`}
                style={{
                  left: `${startPercent}%`,
                  width: `${endPercent - startPercent}%`,
                }}
              />

              {/* Start handle */}
              <div
                className="absolute top-0 bottom-0 w-3 z-20 flex items-center justify-center pointer-events-none"
                style={{ left: `calc(${startPercent}% - 6px)` }}
              >
                <div className={`w-0.5 h-8 ${nextColor.dot} rounded-full`} />
              </div>

              {/* End handle */}
              <div
                className="absolute top-0 bottom-0 w-3 z-20 flex items-center justify-center pointer-events-none"
                style={{ left: `calc(${endPercent}% - 6px)` }}
              >
                <div className={`w-0.5 h-8 ${nextColor.dot} rounded-full`} />
              </div>
            </>
          );
        }

        // No pendingTrimEnd - waiting for second click, show dashed start line only
        // Use the next trim's color for the dashed line too
        const dotColor = nextColor.dot.replace('bg-', '').replace('-400', '');
        const hexColors: Record<string, string> = {
          'yellow': '#facc15',
          'cyan': '#22d3ee',
          'fuchsia': '#e879f9',
          'green': '#4ade80',
          'orange': '#fb923c',
        };
        const lineColor = hexColors[dotColor] || '#facc15';

        return (
          <div
            className="absolute top-0 bottom-0 w-px z-25 pointer-events-none"
            style={{
              left: `${(pendingTrimStart / duration) * 100}%`,
              background: `repeating-linear-gradient(to bottom, ${lineColor} 0, ${lineColor} 4px, transparent 4px, transparent 8px)`,
            }}
          />
        );
      })()}

      {/* Playhead indicator */}
      {currentTime !== undefined && (
        <div
          className="absolute top-0 bottom-0 w-px bg-white z-30 pointer-events-none"
          style={{ left: `${(currentTime / duration) * 100}%` }}
        />
      )}
    </div>
  );
}
