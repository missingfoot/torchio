import { useState, useCallback } from "react";
import { Plus, Trash2, Eye, EyeOff, Wand2, Loader2 } from "lucide-react";
import { Button, ButtonGroup } from "./ui/button";
import { formatDuration } from "@/lib/utils";
import type { Trim, Marker } from "@/types";
import { TRIM_COLORS } from "@/hooks/useTrimManager";

const QUICK_DURATIONS = [2, 5, 8, 10, 15, 20, 25, 30];

interface TrimSidebarProps {
  // Data
  trims: Trim[];
  markers: Marker[];
  duration: number;
  loading: boolean;
  selectedMarkerId: number | null;

  // Visibility
  trimsVisible: boolean;
  markersVisible: boolean;

  // Scene detection
  isDetectingScenes: boolean;

  // Callbacks
  onAddTrim: () => void;
  onAddMarker: () => void;
  onDeleteTrim: (id: number) => void;
  onDeleteMarker: (id: number) => void;
  onUpdateTrimName: (id: number, name: string) => void;
  onUpdateMarkerName: (id: number, name: string) => void;
  onSeek: (time: number) => void;
  onSelectMarker: (id: number) => void;
  onToggleTrimsVisible: () => void;
  onToggleMarkersVisible: () => void;
  onClearAllTrims: () => void;
  onClearAllMarkers: () => void;
  onQuickDuration: (seconds: number) => void;
  onAutoDetect: (threshold: number) => void;
}

type SidebarTab = 'trims' | 'markers';

export function TrimSidebar({
  trims,
  markers,
  duration,
  loading,
  selectedMarkerId,
  trimsVisible,
  markersVisible,
  isDetectingScenes,
  onAddTrim,
  onAddMarker,
  onDeleteTrim,
  onDeleteMarker,
  onUpdateTrimName,
  onUpdateMarkerName,
  onSeek,
  onSelectMarker,
  onToggleTrimsVisible,
  onToggleMarkersVisible,
  onClearAllTrims,
  onClearAllMarkers,
  onQuickDuration,
  onAutoDetect,
}: TrimSidebarProps) {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('trims');
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [autoDetectOpen, setAutoDetectOpen] = useState(false);

  // Inline editing state for trims
  const [editingTrimId, setEditingTrimId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  // Inline editing state for markers
  const [editingMarkerId, setEditingMarkerId] = useState<number | null>(null);
  const [editingMarkerName, setEditingMarkerName] = useState('');

  // Start editing a trim name
  const startEditingTrimName = useCallback((trim: Trim, index: number) => {
    setEditingTrimId(trim.id);
    setEditingName(trim.name || `Trim ${index + 1}`);
  }, []);

  // Save the edited trim name
  const saveEditingTrimName = useCallback(() => {
    if (editingTrimId !== null) {
      onUpdateTrimName(editingTrimId, editingName);
      setEditingTrimId(null);
      setEditingName('');
    }
  }, [editingTrimId, editingName, onUpdateTrimName]);

  // Start editing a marker name
  const startEditingMarkerName = useCallback((marker: Marker, index: number) => {
    setEditingMarkerId(marker.id);
    setEditingMarkerName(marker.name || `Chapter ${index + 1}`);
  }, []);

  // Save the edited marker name
  const saveEditingMarkerName = useCallback(() => {
    if (editingMarkerId !== null) {
      onUpdateMarkerName(editingMarkerId, editingMarkerName);
      setEditingMarkerId(null);
      setEditingMarkerName('');
    }
  }, [editingMarkerId, editingMarkerName, onUpdateMarkerName]);

  const handleQuickDuration = (seconds: number) => {
    onQuickDuration(seconds);
    setPresetsOpen(false);
  };

  const handleAutoDetect = (threshold: number) => {
    setAutoDetectOpen(false);
    onAutoDetect(threshold);
  };

  return (
    <div className="w-[280px] border-l bg-background flex flex-col">
      {/* Tab switcher */}
      <div className="p-2">
        <ButtonGroup className="w-full">
          <Button
            variant="subtle"
            size="sm"
            onClick={() => setSidebarTab('trims')}
            className={`flex-1 ${sidebarTab === 'trims' ? 'bg-muted text-foreground' : ''}`}
          >
            Trims
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => setSidebarTab('markers')}
            className={`flex-1 ${sidebarTab === 'markers' ? 'bg-muted text-foreground' : ''}`}
          >
            Markers
          </Button>
        </ButtonGroup>
      </div>

      {/* Action bar */}
      <div className="px-2 pt-1.5 pb-3 border-b flex items-center gap-2">
        <Button
          variant="subtle"
          size="sm"
          className="flex-1"
          onClick={sidebarTab === 'trims' ? onAddTrim : onAddMarker}
          disabled={loading}
        >
          <Plus className="h-4 w-4 mr-1" />
          {sidebarTab === 'trims' ? 'Trim' : 'Marker'}
        </Button>
        {sidebarTab === 'trims' && (
          <>
            <div className="relative flex-1">
              <Button
                variant="subtle"
                size="sm"
                className="w-full"
                onClick={() => setPresetsOpen(!presetsOpen)}
                disabled={loading}
              >
                <Plus className="h-4 w-4 mr-1" />
                Preset
              </Button>
              {presetsOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setPresetsOpen(false)}
                  />
                  <div className="absolute top-full left-0 mt-1 bg-background border rounded-md shadow-lg z-50 py-1 min-w-full">
                    {QUICK_DURATIONS.map((sec) => (
                      <button
                        key={sec}
                        onClick={() => handleQuickDuration(sec)}
                        disabled={duration < sec}
                        className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="relative flex-1">
              <Button
                variant="subtle"
                size="sm"
                className="w-full"
                onClick={() => !isDetectingScenes && setAutoDetectOpen(!autoDetectOpen)}
                disabled={loading || isDetectingScenes}
              >
                {isDetectingScenes ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4 mr-1" />
                )}
                Auto
              </Button>
              {autoDetectOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setAutoDetectOpen(false)}
                  />
                  <div className="absolute top-full right-0 mt-1 bg-background border rounded-md shadow-lg z-50 py-1 min-w-[140px]">
                    <div className="px-3 py-1.5 text-xs text-muted-foreground font-medium">
                      Detection strength
                    </div>
                    <button
                      onClick={() => handleAutoDetect(0.5)}
                      className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted whitespace-nowrap"
                    >
                      Low
                    </button>
                    <button
                      onClick={() => handleAutoDetect(0.3)}
                      className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted whitespace-nowrap"
                    >
                      Medium
                    </button>
                    <button
                      onClick={() => handleAutoDetect(0.2)}
                      className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted whitespace-nowrap"
                    >
                      High
                    </button>
                    <button
                      onClick={() => handleAutoDetect(0.1)}
                      className="w-full px-3 py-1.5 text-sm text-left hover:bg-muted whitespace-nowrap"
                    >
                      Very High
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sidebarTab === 'trims' ? (
          trims.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground text-sm px-4">
              <p>No trims yet</p>
              <p className="text-xs mt-1">Click + to add a trim</p>
            </div>
          ) : (
            trims.map((trim, index) => {
              const color = TRIM_COLORS[trim.colorIndex];
              const trimDuration = trim.endTime - trim.startTime;
              return (
                <div
                  key={trim.id}
                  className="flex rounded bg-muted/50 hover:bg-muted transition-colors overflow-hidden cursor-pointer"
                  onClick={() => onSeek(trim.startTime)}
                >
                  {/* Color bar */}
                  <div className={`w-1 ${color.dot}`} />
                  {/* Content */}
                  <div className="flex-1 p-2">
                    {/* Row 1: Name and delete */}
                    <div className="flex items-center justify-between">
                      {editingTrimId === trim.id ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              saveEditingTrimName();
                            } else if (e.key === 'Escape') {
                              setEditingTrimId(null);
                              setEditingName('');
                            }
                          }}
                          onBlur={saveEditingTrimName}
                          onFocus={(e) => e.target.select()}
                          autoFocus
                          className={`text-sm font-medium ${color.text} bg-transparent outline-none w-full mr-2`}
                        />
                      ) : (
                        <span
                          className={`text-sm font-medium ${color.text} cursor-text`}
                          onClick={(e) => { e.stopPropagation(); startEditingTrimName(trim, index); }}
                        >
                          {trim.name || `Trim ${index + 1}`}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteTrim(trim.id); }}
                        className="text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Row 2: Times */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                      <span>
                        {formatDuration(trim.startTime)} -&gt; {formatDuration(trim.endTime)}
                      </span>
                      <span>{formatDuration(trimDuration)}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )
        ) : (
          markers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground text-sm px-4">
              <p>No markers yet</p>
              <p className="text-xs mt-1">Click + to add a marker</p>
            </div>
          ) : (
            markers.map((marker, index) => {
              const isSelected = selectedMarkerId === marker.id;
              return (
                <div
                  key={marker.id}
                  className={`flex rounded transition-colors overflow-hidden cursor-pointer ${isSelected ? 'bg-muted' : 'bg-muted/50 hover:bg-muted'}`}
                  onClick={() => {
                    onSeek(marker.time);
                    onSelectMarker(marker.id);
                  }}
                >
                  {/* Red color bar (always red) */}
                  <div className="w-1 bg-red-400" />
                  {/* Content */}
                  <div className="flex-1 p-2">
                    {/* Row 1: Name and delete */}
                    <div className="flex items-center justify-between">
                      {editingMarkerId === marker.id ? (
                        <input
                          type="text"
                          value={editingMarkerName}
                          onChange={(e) => setEditingMarkerName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEditingMarkerName();
                            if (e.key === 'Escape') { setEditingMarkerId(null); setEditingMarkerName(''); }
                          }}
                          onBlur={saveEditingMarkerName}
                          onFocus={(e) => e.target.select()}
                          autoFocus
                          className="text-sm font-medium text-red-400 bg-transparent outline-none w-full mr-2"
                        />
                      ) : (
                        <span
                          className="text-sm font-medium text-red-400 cursor-text"
                          onClick={(e) => { e.stopPropagation(); startEditingMarkerName(marker, index); }}
                        >
                          {marker.name || `Chapter ${index + 1}`}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteMarker(marker.id); }}
                        className="text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Row 2: Timestamp */}
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDuration(marker.time)}
                    </div>
                  </div>
                </div>
              );
            })
          )
        )}
      </div>

      {/* Bottom bar */}
      <div className="px-2 py-2 border-t flex gap-2">
        {sidebarTab === 'trims' ? (
          <Button
            variant="subtle"
            size="sm"
            onClick={onToggleTrimsVisible}
            disabled={trims.length === 0}
            className="flex-1"
          >
            {trimsVisible ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {trimsVisible ? "Hide trims" : "Show trims"}
          </Button>
        ) : (
          <Button
            variant="subtle"
            size="sm"
            onClick={onToggleMarkersVisible}
            disabled={markers.length === 0}
            className="flex-1"
          >
            {markersVisible ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {markersVisible ? "Hide markers" : "Show markers"}
          </Button>
        )}
        <Button
          variant="subtle"
          size="sm"
          className="flex-1 hover:bg-red-500/20 hover:text-red-400"
          onClick={sidebarTab === 'trims' ? onClearAllTrims : onClearAllMarkers}
          disabled={sidebarTab === 'trims' ? trims.length === 0 : markers.length === 0}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          Clear all
        </Button>
      </div>
    </div>
  );
}
