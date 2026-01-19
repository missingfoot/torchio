import { useRef, useCallback, useState } from "react";
import type { Trim, Marker } from "@/types";
import { formatDuration } from "@/lib/utils";

// Utility: Snap a time value to the nearest locked time if within threshold
function snapToLockedTime(
  time: number,
  lockedTimes: number[],
  rect: DOMRect,
  duration: number
): number {
  const snapPixels = 5;
  const snapThreshold = (snapPixels / rect.width) * duration;
  for (const lt of lockedTimes) {
    if (Math.abs(time - lt) < snapThreshold) {
      return lt;
    }
  }
  return time;
}

// Reusable component: Timeline handle (start/end drag handles)
interface TimelineHandleProps {
  position: number; // percentage
  colorClass: string;
  onMouseDown?: (e: React.MouseEvent) => void;
  interactive?: boolean;
  edge: 'start' | 'end'; // which edge - determines positioning
}

function TimelineHandle({ position, colorClass, onMouseDown, interactive = true, edge }: TimelineHandleProps) {
  // Position handle on outer edge: start handle to the left, end handle to the right
  const offset = edge === 'start' ? '-12px' : '0px';
  return (
    <div
      className={`absolute top-0 bottom-0 w-3 ${interactive ? 'cursor-ew-resize' : ''} z-20 flex items-center justify-center ${!interactive ? 'pointer-events-none' : ''}`}
      style={{ left: `calc(${position}% + ${offset})` }}
      onMouseDown={interactive ? onMouseDown : undefined}
    >
      <div className={`w-[3px] h-8 ${colorClass} rounded-full`} />
    </div>
  );
}

// Reusable component: Timeline region (trim/loop zone area)
interface TimelineRegionProps {
  startPercent: number;
  endPercent: number;
  borderClass: string;
  bgClass?: string;
  onMouseDown?: (e: React.MouseEvent) => void;
  interactive?: boolean;
  className?: string;
}

function TimelineRegion({ startPercent, endPercent, borderClass, bgClass = '', onMouseDown, interactive = true, className = '' }: TimelineRegionProps) {
  return (
    <div
      className={`absolute top-0 bottom-0 border ${borderClass} ${bgClass} ${interactive ? 'cursor-move' : 'pointer-events-none'} ${className}`}
      style={{
        left: `${startPercent}%`,
        width: `${endPercent - startPercent}%`,
      }}
      onMouseDown={interactive ? onMouseDown : undefined}
    />
  );
}

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
  markersVisible: boolean;
  onTrimUpdate: (id: number, startTime: number, endTime: number) => void;
  onHover?: (time: number | null) => void;
  markers?: Marker[];
  selectedMarkerId?: number | null;
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
  onMarkerUpdate: (id: number, time: number) => void;
  onPendingTrimChange: (time: number | null) => void;
  onPendingTrimEndChange: (time: number | null) => void;
  // Loop zone props (seek mode)
  loopZone: { start: number; end: number } | null;
  onLoopZoneChange: (zone: { start: number; end: number } | null) => void;
  // Playhead lock (seek mode - click to lock/unlock hover following)
  playheadLocked: boolean;
  onPlayheadLockChange: (locked: boolean) => void;
  // Cached frame times for visual indicator
  cachedTimes?: number[];
  // Snapping toggle
  snappingEnabled: boolean;
}

export function TrimBar({
  duration,
  trims,
  trimsVisible,
  markersVisible,
  onTrimUpdate,
  onHover,
  markers = [],
  selectedMarkerId,
  filmstrip = [],
  currentTime,
  colors,
  mode,
  pendingTrimStart,
  pendingTrimEnd,
  onSeek,
  onTrimCreate,
  onMarkerAdd,
  onMarkerUpdate,
  onPendingTrimChange,
  onPendingTrimEndChange,
  loopZone,
  onLoopZoneChange,
  playheadLocked,
  onPlayheadLockChange,
  cachedTimes = [],
  snappingEnabled,
}: TrimBarProps) {
  // Helper to get snap targets excluding a specific trim's edges (for self-snapping prevention)
  const getSnapTargetsForTrim = useCallback((excludeTrimId: number) => {
    return [
      ...markers.map(m => m.time),
      ...trims
        .filter(t => t.id !== excludeTrimId)
        .flatMap(t => [t.startTime, t.endTime])
    ];
  }, [markers, trims]);

  const barRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const isClickingRef = useRef(false); // Prevent hover from overwriting click
  const [hoverInfo, setHoverInfo] = useState<{ x: number; time: number } | null>(null);

  const getTimeFromPosition = useCallback(
    (clientX: number) => {
      if (!barRef.current) return 0;
      const rect = barRef.current.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return percent * duration;
    },
    [duration]
  );

  // Helper to update hover info from drag handlers
  const updateHoverFromClientX = useCallback((clientX: number) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const time = getTimeFromPosition(clientX);
    setHoverInfo({ x: clientX - rect.left, time });
  }, [getTimeFromPosition]);

  // Generic factory for creating handle drag handlers (start/end)
  const createHandleDrag = useCallback(
    (config: {
      getRange: () => { start: number; end: number };
      onUpdate: (start: number, end: number) => void;
      onMove?: (time: number) => void;
      edge: 'start' | 'end';
      minDuration: number;
      enableSnapping: boolean;
      snapTargets: number[];
    }) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;

      const initial = config.getRange();

      const handleMouseMove = (ev: MouseEvent) => {
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        let time = getTimeFromPosition(ev.clientX);

        if (config.enableSnapping) {
          time = snapToLockedTime(time, config.snapTargets, rect, duration);
        }

        let newStart = initial.start;
        let newEnd = initial.end;

        if (config.edge === 'start') {
          newStart = Math.max(0, Math.min(time, initial.end - config.minDuration));
        } else {
          newEnd = Math.max(initial.start + config.minDuration, Math.min(time, duration));
        }

        config.onUpdate(newStart, newEnd);
        config.onMove?.(config.edge === 'start' ? newStart : newEnd);
        updateHoverFromClientX(ev.clientX);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setTimeout(() => { isDraggingRef.current = false; }, 0);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [getTimeFromPosition, duration, updateHoverFromClientX]
  );

  // Generic factory for creating region drag handlers
  const createRegionDrag = useCallback(
    (config: {
      getRange: () => { start: number; end: number };
      onUpdate: (start: number, end: number) => void;
      onMove?: (time: number) => void;
      enableSnapping: boolean;
      snapTargets: number[];
      trackEdge?: 'start' | 'end';
    }) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = true;

      const startX = e.clientX;
      const initial = config.getRange();
      const regionDuration = initial.end - initial.start;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!barRef.current) return;
        const rect = barRef.current.getBoundingClientRect();
        const deltaX = ev.clientX - startX;
        const deltaTime = (deltaX / rect.width) * duration;

        let newStart = initial.start + deltaTime;
        let newEnd = initial.end + deltaTime;

        // Clamp to bounds
        if (newStart < 0) {
          newStart = 0;
          newEnd = regionDuration;
        }
        if (newEnd > duration) {
          newEnd = duration;
          newStart = duration - regionDuration;
        }

        // Snap to locked times (check both edges)
        if (config.enableSnapping) {
          const snappedStart = snapToLockedTime(newStart, config.snapTargets, rect, duration);
          if (snappedStart !== newStart) {
            newStart = snappedStart;
            newEnd = snappedStart + regionDuration;
          } else {
            const snappedEnd = snapToLockedTime(newEnd, config.snapTargets, rect, duration);
            if (snappedEnd !== newEnd) {
              newEnd = snappedEnd;
              newStart = snappedEnd - regionDuration;
            }
          }
        }

        config.onUpdate(newStart, newEnd);
        config.onMove?.(config.trackEdge === 'end' ? newEnd : newStart);
        updateHoverFromClientX(ev.clientX);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        setTimeout(() => { isDraggingRef.current = false; }, 0);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [duration, updateHoverFromClientX]
  );

  // Trim drag handlers (using factories)
  const handleStartDrag = useCallback(
    (e: React.MouseEvent, trim: Trim) => createHandleDrag({
      getRange: () => ({ start: trim.startTime, end: trim.endTime }),
      onUpdate: (start, end) => onTrimUpdate(trim.id, start, end),
      onMove: onHover,
      edge: 'start',
      minDuration: 1,
      enableSnapping: snappingEnabled,
      snapTargets: getSnapTargetsForTrim(trim.id),
    })(e),
    [createHandleDrag, onTrimUpdate, onHover, snappingEnabled, getSnapTargetsForTrim]
  );

  const handleEndDrag = useCallback(
    (e: React.MouseEvent, trim: Trim) => createHandleDrag({
      getRange: () => ({ start: trim.startTime, end: trim.endTime }),
      onUpdate: (start, end) => onTrimUpdate(trim.id, start, end),
      onMove: onHover,
      edge: 'end',
      minDuration: 1,
      enableSnapping: snappingEnabled,
      snapTargets: getSnapTargetsForTrim(trim.id),
    })(e),
    [createHandleDrag, onTrimUpdate, onHover, snappingEnabled, getSnapTargetsForTrim]
  );

  const handleRegionDrag = useCallback(
    (e: React.MouseEvent, trim: Trim) => {
      // Determine which half of the trim was clicked to track that edge
      const clickTime = getTimeFromPosition(e.clientX);
      const trimMidpoint = (trim.startTime + trim.endTime) / 2;
      const trackEdge = clickTime < trimMidpoint ? 'start' : 'end';

      createRegionDrag({
        getRange: () => ({ start: trim.startTime, end: trim.endTime }),
        onUpdate: (start, end) => onTrimUpdate(trim.id, start, end),
        onMove: onHover,
        enableSnapping: snappingEnabled,
        snapTargets: getSnapTargetsForTrim(trim.id),
        trackEdge,
      })(e);
    },
    [createRegionDrag, onTrimUpdate, onHover, snappingEnabled, getSnapTargetsForTrim, getTimeFromPosition]
  );

  // Loop zone drag handlers (using factories)
  const handleLoopZoneStartDrag = useCallback(
    (e: React.MouseEvent) => {
      if (!loopZone) return;
      createHandleDrag({
        getRange: () => ({ start: loopZone.start, end: loopZone.end }),
        onUpdate: (start, end) => onLoopZoneChange({ start, end }),
        onMove: onSeek,
        edge: 'start',
        minDuration: 0.3,
        enableSnapping: false,
        snapTargets: [],
      })(e);
    },
    [loopZone, createHandleDrag, onLoopZoneChange, onSeek]
  );

  const handleLoopZoneEndDrag = useCallback(
    (e: React.MouseEvent) => {
      if (!loopZone) return;
      createHandleDrag({
        getRange: () => ({ start: loopZone.start, end: loopZone.end }),
        onUpdate: (start, end) => onLoopZoneChange({ start, end }),
        onMove: onSeek,
        edge: 'end',
        minDuration: 0.3,
        enableSnapping: false,
        snapTargets: [],
      })(e);
    },
    [loopZone, createHandleDrag, onLoopZoneChange, onSeek]
  );

  const handleLoopZoneRegionDrag = useCallback(
    (e: React.MouseEvent) => {
      if (!loopZone) return;
      createRegionDrag({
        getRange: () => ({ start: loopZone.start, end: loopZone.end }),
        onUpdate: (start, end) => onLoopZoneChange({ start, end }),
        onMove: onSeek,
        enableSnapping: false,
        snapTargets: [],
      })(e);
    },
    [loopZone, createRegionDrag, onLoopZoneChange, onSeek]
  );

  // Handle mousedown on the bar for mode-specific behavior
  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Don't interfere with trim handle/region drags
      if (isDraggingRef.current) return;

      const time = getTimeFromPosition(e.clientX);

      switch (mode) {
        case 'select':
          // Clear any existing loop zone first
          if (loopZone) {
            onLoopZoneChange(null);
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
            onHover?.(currentT); // Update frame preview
            updateHoverFromClientX(ev.clientX);

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
              onHover?.(currentT); // Update frame preview
              updateHoverFromClientX(ev.clientX);
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
    [mode, pendingTrimStart, getTimeFromPosition, onSeek, onTrimCreate, onMarkerAdd, onPendingTrimChange, onPendingTrimEndChange, loopZone, onLoopZoneChange, playheadLocked, onPlayheadLockChange, updateHoverFromClientX]
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
      className={`relative h-16 bg-muted overflow-visible select-none ${cursorClass}`}
      onMouseMove={(e) => {
        const time = getTimeFromPosition(e.clientX);
        // Track position for hover tooltip (always update)
        if (barRef.current) {
          const rect = barRef.current.getBoundingClientRect();
          setHoverInfo({ x: e.clientX - rect.left, time });
        }
        // Only update hover preview when not dragging
        if (!isDraggingRef.current && !isClickingRef.current) {
          if (onHover) onHover(time);
        }
      }}
      onMouseLeave={() => {
        onHover?.(null);
        setHoverInfo(null);
      }}
      onMouseDown={handleBarMouseDown}
    >
      {/* Filmstrip background */}
      {filmstrip.length > 0 && (
        <div className="absolute inset-0 flex overflow-hidden rounded-lg">
          {filmstrip.map((frame, i) => (
            <div
              key={i}
              className="flex-1 bg-cover bg-center"
              style={{ backgroundImage: frame ? `url(${frame})` : undefined }}
            />
          ))}
        </div>
      )}

      {/* Cache indicator - shows which frames are cached */}
      {cachedTimes.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 pointer-events-none">
          {cachedTimes.map((time, i) => {
            const percent = (time / duration) * 100;
            const widthPercent = (0.1 / duration) * 100; // Each cache entry covers 0.1s
            return (
              <div
                key={`${time}-${i}`}
                className="absolute top-0 bottom-0 bg-green-500/70"
                style={{
                  left: `${percent}%`,
                  width: `${Math.max(widthPercent, 0.5)}%`, // Min width for visibility
                }}
              />
            );
          })}
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
            <TimelineRegion
              startPercent={startPercent}
              endPercent={endPercent}
              borderClass={color.border}
              bgClass={color.bg}
              onMouseDown={(e) => handleRegionDrag(e, trim)}
            />
            <TimelineHandle
              position={startPercent}
              colorClass={color.dot}
              onMouseDown={(e) => handleStartDrag(e, trim)}
              edge="start"
            />
            <TimelineHandle
              position={endPercent}
              colorClass={color.dot}
              onMouseDown={(e) => handleEndDrag(e, trim)}
              edge="end"
            />
          </div>
        );
      })}

      {/* Marker indicators with dots above */}
      {markersVisible && markers.map((marker) => {
        const isSelected = selectedMarkerId === marker.id;
        const leftPercent = (marker.time / duration) * 100;
        return (
          <div
            key={marker.id}
            className="absolute top-0 bottom-0 z-20 hover:z-40 cursor-ew-resize group"
            style={{
              left: `${leftPercent}%`,
              width: '13px',
              marginLeft: '-6px',
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              isDraggingRef.current = true;

              const handleMouseMove = (ev: MouseEvent) => {
                const time = Math.max(0, Math.min(duration, getTimeFromPosition(ev.clientX)));
                onMarkerUpdate(marker.id, time);
                onSeek(time);
                onHover?.(time);
                updateHoverFromClientX(ev.clientX);
              };

              const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                setTimeout(() => { isDraggingRef.current = false; }, 0);
              };

              document.addEventListener('mousemove', handleMouseMove);
              document.addEventListener('mouseup', handleMouseUp);
            }}
          >
            {/* Square flag - expands on hover or when selected to show name */}
            <div
              className="absolute flex items-center whitespace-nowrap overflow-hidden transition-all duration-150 bg-red-400 text-zinc-900"
              style={{
                left: '6px',
                top: -13,
                height: '11px',
                fontSize: '9px',
                lineHeight: 1,
                paddingRight: '3px',
                paddingBottom: '1px',
                borderTopRightRadius: '2px',
                borderBottomRightRadius: '2px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              <div className="w-[10px] flex-shrink-0" />
              <span
                className={`overflow-hidden transition-all duration-150 ${isSelected ? 'max-w-[100px]' : 'max-w-0 group-hover:max-w-[100px]'}`}
              >
                {marker.name || `Marker ${marker.id}`}
              </span>
            </div>
            {/* Vertical line (flagpole) */}
            <div
              className="absolute bottom-0 w-px bg-red-400"
              style={{ left: '6px', top: -13 }}
            />
          </div>
        );
      })}

      {/* Loop zone indicator (styled like a trim but blue) */}
      {loopZone && (() => {
        const startPercent = (loopZone.start / duration) * 100;
        const endPercent = (loopZone.end / duration) * 100;
        return (
          <>
            <TimelineRegion
              startPercent={startPercent}
              endPercent={endPercent}
              borderClass="border-blue-400"
              onMouseDown={handleLoopZoneRegionDrag}
            />
            <TimelineHandle
              position={startPercent}
              colorClass="bg-blue-400"
              onMouseDown={handleLoopZoneStartDrag}
              edge="start"
            />
            <TimelineHandle
              position={endPercent}
              colorClass="bg-blue-400"
              onMouseDown={handleLoopZoneEndDrag}
              edge="end"
            />
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
              <TimelineRegion
                startPercent={startPercent}
                endPercent={endPercent}
                borderClass={nextColor.border}
                bgClass={nextColor.bg}
                interactive={false}
                className="z-15"
              />
              <TimelineHandle
                position={startPercent}
                colorClass={nextColor.dot}
                interactive={false}
                edge="start"
              />
              <TimelineHandle
                position={endPercent}
                colorClass={nextColor.dot}
                interactive={false}
                edge="end"
              />
            </>
          );
        }

        // No pendingTrimEnd - waiting for second click, show dashed start line only
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

      {/* Hover time tooltip */}
      {hoverInfo && (
        <div
          className="absolute pointer-events-none z-50 -bottom-6 transform -translate-x-1/2 bg-zinc-800 text-white text-[10px] px-1.5 py-0.5 rounded shadow"
          style={{ left: hoverInfo.x }}
        >
          {formatDuration(hoverInfo.time)}
        </div>
      )}

      {/* Playhead indicator */}
      {currentTime !== undefined && (
        <div
          className={`absolute top-0 bottom-0 z-50 ${playheadLocked ? 'cursor-ew-resize' : 'pointer-events-none'}`}
          style={{
            left: `${(currentTime / duration) * 100}%`,
            width: '13px',
            marginLeft: '-6px',
          }}
          onMouseDown={playheadLocked ? (e) => {
            e.preventDefault();
            e.stopPropagation();
            isDraggingRef.current = true;

            const handleMouseMove = (ev: MouseEvent) => {
              const time = getTimeFromPosition(ev.clientX);
              onSeek(time);
              onHover?.(time);
              updateHoverFromClientX(ev.clientX);
            };

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
              setTimeout(() => { isDraggingRef.current = false; }, 0);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          } : undefined}
        >
          {/* Line - fixed at 6px to avoid subpixel blur */}
          <div
            className={`absolute top-0 bottom-0 w-px ${playheadLocked ? 'bg-blue-400' : 'bg-white'}`}
            style={{ left: '6px' }}
          />
          {/* Dots - 9px, fixed at 2px to center in 13px container */}
          <div
            className={`absolute -top-1.5 w-[9px] h-[9px] rounded-full ${playheadLocked ? 'bg-blue-400' : 'bg-white'}`}
            style={{ left: '2px' }}
          />
          <div
            className={`absolute -bottom-1.5 w-[9px] h-[9px] rounded-full ${playheadLocked ? 'bg-blue-400' : 'bg-white'}`}
            style={{ left: '2px' }}
          />
        </div>
      )}
    </div>
  );
}
