import { SquareSplitHorizontal, Scissors, Volume2, VolumeX, Magnet } from "lucide-react";
import { Button, ButtonGroup } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface PlaybackControlsProps {
  // State
  isPlaying: boolean;
  loading: boolean;
  isMuted: boolean;
  volume: number;
  loopZone: { start: number; end: number } | null;
  snappingEnabled: boolean;

  // Callbacks
  onGoToStart: () => void;
  onStepBackward: () => void;
  onStepForward: () => void;
  onTogglePlay: () => void;
  onAddMarker: () => void;
  onAddTrim: () => void;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleSnapping: () => void;
}

export function PlaybackControls({
  isPlaying,
  loading,
  isMuted,
  volume,
  loopZone,
  snappingEnabled,
  onGoToStart,
  onStepBackward,
  onStepForward,
  onTogglePlay,
  onAddMarker,
  onAddTrim,
  onToggleMute,
  onVolumeChange,
  onToggleSnapping,
}: PlaybackControlsProps) {
  const handleVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    const newVolume = Math.max(0, Math.min(1, volume + delta));
    onVolumeChange(newVolume);
  };

  const handleVolumeSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    onVolumeChange(val);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Restart */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="subtle"
            size="icon"
            onClick={onGoToStart}
            disabled={loading}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10,1H3A1,1,0,0,0,3,3h7a3,3,0,0,1,0,6H4.414L6.707,6.707A1,1,0,0,0,5.293,5.293l-4,4a1,1,0,0,0,0,1.414l4,4a1,1,0,1,0,1.414-1.414L4.414,11H10A5,5,0,0,0,10,1Z"/>
            </svg>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Restart <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">↑</kbd></p>
        </TooltipContent>
      </Tooltip>

      <ButtonGroup>
        {/* Step backward */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="subtle"
              size="icon"
              onClick={onStepBackward}
              disabled={loading || isPlaying}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4,8.001C4,8.327,4.159,8.633,4.427,8.82l10,7c0.305,0.214,0.704,0.238,1.035,0.068 C15.793,15.715,16,15.374,16,15.001V0.999c0-0.373-0.207-0.715-0.538-0.887c-0.331-0.17-0.73-0.146-1.035,0.068l-10,7 C4.159,7.367,4,7.673,4,7.999C4,8,4,8,4,8.001C4,8,4,8,4,8.001z"/>
                <path d="M1,0c0.552,0,1,0.447,1,1v14c0,0.553-0.448,1-1,1s-1-0.447-1-1L0,1C0,0.447,0.448,0,1,0z"/>
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Step back <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">←</kbd></p>
          </TooltipContent>
        </Tooltip>

        {/* Play/Pause */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="subtle"
              size="icon"
              onClick={onTogglePlay}
              disabled={loading}
            >
              {isPlaying ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5,1H2C1.4,1,1,1.4,1,2v12c0,0.6,0.4,1,1,1h3c0.6,0,1-0.4,1-1V2C6,1.4,5.6,1,5,1z"/>
                  <path d="M14,1h-3c-0.6,0-1,0.4-1,1v12c0,0.6,0.4,1,1,1h3c0.6,0,1-0.4,1-1V2C15,1.4,14.6,1,14,1z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M14,7.999c0-0.326-0.159-0.632-0.427-0.819l-10-7C3.269-0.034,2.869-0.058,2.538,0.112 C2.207,0.285,2,0.626,2,0.999v14.001c0,0.373,0.207,0.715,0.538,0.887c0.331,0.17,0.73,0.146,1.035-0.068l10-7 C13.841,8.633,14,8.327,14,8.001C14,8,14,8,14,7.999C14,8,14,8,14,7.999z"/>
                </svg>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{isPlaying ? "Pause" : "Play"} <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">Space</kbd></p>
          </TooltipContent>
        </Tooltip>

        {/* Step forward */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="subtle"
              size="icon"
              onClick={onStepForward}
              disabled={loading || isPlaying}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M12,7.999c0-0.326-0.159-0.632-0.427-0.819l-10-7C1.269-0.034,0.869-0.058,0.538,0.112 C0.207,0.285,0,0.626,0,0.999v14.001c0,0.373,0.207,0.715,0.538,0.887c0.331,0.17,0.73,0.146,1.035-0.068l10-7 C11.841,8.633,12,8.327,12,8.001C12,8,12,8,12,7.999C12,8,12,8,12,7.999z"/>
                <path d="M15,16c-0.552,0-1-0.447-1-1V1c0-0.553,0.448-1,1-1s1,0.447,1,1v14C16,15.553,15.552,16,15,16z"/>
              </svg>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Step forward <kbd className="ml-1 px-1 py-0.5 bg-zinc-700 rounded text-[10px]">→</kbd></p>
          </TooltipContent>
        </Tooltip>
      </ButtonGroup>

      {/* Add marker */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="subtle"
            size="icon"
            onClick={onAddMarker}
            disabled={loading}
          >
            <SquareSplitHorizontal className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{loopZone ? "Add markers at selection" : "Add marker at playhead"}</p>
        </TooltipContent>
      </Tooltip>

      {/* Add trim at playhead */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="subtle"
            size="icon"
            onClick={onAddTrim}
            disabled={loading}
          >
            <Scissors className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{loopZone ? "Add trim from selection" : "Add trim at playhead"}</p>
        </TooltipContent>
      </Tooltip>

      {/* Divider */}
      <div className="h-5 w-px bg-border ml-2" />

      {/* Snap toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="subtle"
            size="icon"
            onClick={onToggleSnapping}
            className={snappingEnabled ? 'bg-blue-500/20 text-blue-400' : ''}
          >
            <Magnet className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>Toggle snapping (trims snap to markers and other trim edges)</p>
        </TooltipContent>
      </Tooltip>

      {/* Volume controls */}
      <div className="flex items-center gap-3 ml-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="subtle"
              size="icon"
              onClick={onToggleMute}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{isMuted ? "Unmute" : "Mute"}</p>
          </TooltipContent>
        </Tooltip>
        <div
          className="relative w-20 h-8 flex items-center group"
          onWheel={handleVolumeWheel}
        >
          {/* Background track */}
          <div className="absolute left-0 w-full h-1 bg-white/20 rounded-full" />
          {/* Filled portion */}
          <div
            className="absolute left-0 h-1 bg-white rounded-full z-[1]"
            style={{ width: `${(isMuted ? 0 : volume) * 100}%` }}
          />
          {/* Input with transparent track */}
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            onChange={handleVolumeSlider}
            className="absolute w-full h-1 appearance-none bg-transparent cursor-pointer z-10
              [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:transition-shadow [&::-webkit-slider-thumb]:duration-150 [&::-webkit-slider-thumb]:shadow-[0_0_0_0px_rgba(255,255,255,0.2)]
              [&::-webkit-slider-thumb]:hover:shadow-[0_0_0_4px_rgba(255,255,255,0.2)]
              [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent
              [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:transition-shadow [&::-moz-range-thumb]:duration-150 [&::-moz-range-thumb]:shadow-[0_0_0_0px_rgba(255,255,255,0.2)]
              [&::-moz-range-thumb]:hover:shadow-[0_0_0_4px_rgba(255,255,255,0.2)]"
          />
        </div>
      </div>
    </div>
  );
}
