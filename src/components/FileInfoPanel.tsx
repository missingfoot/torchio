import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatBytes, formatDuration } from "@/lib/utils";
import { Film, Music, FileVideo, Loader2, X, Copy, Check } from "lucide-react";

interface MediaMetadata {
  video_codec: string | null;
  video_codec_long: string | null;
  width: number;
  height: number;
  frame_rate: string | null;
  frame_rate_decimal: number | null;
  video_bitrate: number | null;
  pixel_format: string | null;
  color_space: string | null;
  duration: number;
  audio_codec: string | null;
  audio_codec_long: string | null;
  audio_channels: number | null;
  audio_channel_layout: string | null;
  audio_sample_rate: number | null;
  audio_bitrate: number | null;
  format_name: string | null;
  format_long_name: string | null;
  overall_bitrate: number | null;
}

interface FileInfoPanelProps {
  open: boolean;
  onClose: () => void;
  filePath: string;
  fileName: string;
  fileSize: number;
  triggerRef?: React.RefObject<HTMLButtonElement>;
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-1 gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground font-medium text-right truncate">{value}</span>
    </div>
  );
}

function InfoSection({ title, icon: Icon, children, showBorder = false }: { title: string; icon: React.ElementType; children: React.ReactNode; showBorder?: boolean }) {
  return (
    <div className={`space-y-1 ${showBorder ? 'pt-3 border-t border-zinc-800' : ''}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      <div className="text-xs">
        {children}
      </div>
    </div>
  );
}

function formatBitrate(bps: number | null | undefined): string | null {
  if (!bps) return null;
  const kbps = bps / 1000;
  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(1)} Mbps`;
  }
  return `${Math.round(kbps)} kbps`;
}

function formatFrameRate(fps: number | null | undefined): string | null {
  if (!fps) return null;
  if (Math.abs(fps - 23.976) < 0.01) return "23.976 fps";
  if (Math.abs(fps - 24) < 0.01) return "24 fps";
  if (Math.abs(fps - 25) < 0.01) return "25 fps";
  if (Math.abs(fps - 29.97) < 0.01) return "29.97 fps";
  if (Math.abs(fps - 30) < 0.01) return "30 fps";
  if (Math.abs(fps - 50) < 0.01) return "50 fps";
  if (Math.abs(fps - 59.94) < 0.01) return "59.94 fps";
  if (Math.abs(fps - 60) < 0.01) return "60 fps";
  return `${fps.toFixed(2)} fps`;
}

function formatChannels(channels: number | null | undefined, layout: string | null | undefined): string | null {
  if (!channels) return null;
  if (layout) {
    if (layout === "stereo") return "Stereo";
    if (layout === "mono") return "Mono";
    if (layout === "5.1" || layout === "5.1(side)") return "5.1";
    if (layout === "7.1") return "7.1";
    return layout;
  }
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  return `${channels}ch`;
}

function formatSampleRate(rate: number | null | undefined): string | null {
  if (!rate) return null;
  return `${(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1)} kHz`;
}

function formatCodec(codec: string | null | undefined): string | null {
  if (!codec) return null;
  const upper = codec.toUpperCase();
  if (upper === "H264") return "H.264";
  if (upper === "H265" || upper === "HEVC") return "H.265";
  if (["AV1", "VP9", "VP8", "AAC", "MP3", "OPUS", "FLAC", "AC3", "EAC3"].includes(upper)) {
    return upper;
  }
  return codec;
}

function getFileExtension(fileName: string): string {
  const parts = fileName.split(".");
  if (parts.length > 1) {
    return parts[parts.length - 1].toUpperCase();
  }
  return "";
}

export function FileInfoPanel({ open, onClose, filePath, fileName, fileSize, triggerRef }: FileInfoPanelProps) {
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isDocked, setIsDocked] = useState(true);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, panelX: 0, panelY: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const copyPath = async () => {
    await navigator.clipboard.writeText(filePath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Reset to docked when closed
  useEffect(() => {
    if (!open) {
      setIsDocked(true);
    }
  }, [open]);

  // Load metadata only if we don't have it for this file
  useEffect(() => {
    if (!open || loadedPath === filePath) return;

    setLoading(true);
    setError(null);

    invoke<MediaMetadata>("get_media_metadata_cmd", { path: filePath })
      .then((data) => {
        setMetadata(data);
        setLoadedPath(filePath);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [open, filePath, loadedPath]);

  // Close on click outside (only when docked)
  useEffect(() => {
    if (!open || !isDocked) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Ignore clicks on the trigger button (let the toggle handle it)
      if (triggerRef?.current?.contains(target)) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onCloseRef.current();
      }
    };

    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 10);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open, isDocked, triggerRef]);

  // Close on escape
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const panel = panelRef.current;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();

    // If currently docked, initialize position from current location
    if (isDocked) {
      setPosition({ x: rect.left, y: rect.top });
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panelX: rect.left,
        panelY: rect.top,
      };
    } else {
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panelX: position.x,
        panelY: position.y,
      };
    }

    setIsDragging(true);
  }, [isDocked, position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      // Undock after moving a threshold
      if (isDocked && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        setIsDocked(false);
      }

      setPosition({
        x: dragStartRef.current.panelX + dx,
        y: dragStartRef.current.panelY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isDocked]);

  if (!open) return null;

  const panelClasses = isDocked
    ? "absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl animate-in fade-in slide-in-from-top-1 duration-150"
    : "fixed z-[100] w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl";

  return (
    <div
      ref={panelRef}
      className={panelClasses}
      style={!isDocked ? { left: position.x, top: position.y } : undefined}
    >
      {/* Header - draggable */}
      <div
        className={`flex items-center justify-between px-3 py-2 border-b border-zinc-700 ${isDocked ? 'cursor-grab' : 'cursor-grab'} ${isDragging ? 'cursor-grabbing' : ''}`}
        onMouseDown={handleMouseDown}
      >
        <span className="text-xs font-medium select-none">File Info</span>
        {!isDocked && (
          <button
            onClick={onClose}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-0.5 rounded hover:bg-zinc-700 transition-colors"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-3 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="text-destructive text-xs p-2 bg-destructive/10 rounded">
            Failed to load: {error}
          </div>
        )}

        {metadata && !loading && (
          <>
            {/* File Info */}
            <InfoSection title="File" icon={FileVideo}>
              <InfoRow label="Size" value={formatBytes(fileSize)} />
              <InfoRow label="Type" value={getFileExtension(fileName)} />
              <InfoRow label="Container" value={metadata.format_long_name} />
              <InfoRow label="Duration" value={formatDuration(metadata.duration)} />
              <InfoRow label="Bitrate" value={formatBitrate(metadata.overall_bitrate)} />
            </InfoSection>

            {/* Video Info */}
            {metadata.width > 0 && (
              <InfoSection title="Video" icon={Film} showBorder>
                <InfoRow label="Resolution" value={`${metadata.width} × ${metadata.height}`} />
                <InfoRow label="Codec" value={formatCodec(metadata.video_codec)} />
                <InfoRow label="Frame Rate" value={formatFrameRate(metadata.frame_rate_decimal)} />
                <InfoRow label="Bitrate" value={formatBitrate(metadata.video_bitrate)} />
                <InfoRow label="Pixel Format" value={metadata.pixel_format?.toUpperCase()} />
                {metadata.color_space && <InfoRow label="Color Space" value={metadata.color_space} />}
              </InfoSection>
            )}

            {/* Audio Info */}
            {metadata.audio_codec && (
              <InfoSection title="Audio" icon={Music} showBorder>
                <InfoRow label="Codec" value={formatCodec(metadata.audio_codec)} />
                <InfoRow label="Channels" value={formatChannels(metadata.audio_channels, metadata.audio_channel_layout)} />
                <InfoRow label="Sample Rate" value={formatSampleRate(metadata.audio_sample_rate)} />
                <InfoRow label="Bitrate" value={formatBitrate(metadata.audio_bitrate)} />
              </InfoSection>
            )}

            {/* Path */}
            <button
              onClick={copyPath}
              className="pt-3 border-t border-zinc-800 flex items-start gap-2 w-full text-left cursor-pointer"
              title="Copy path"
            >
              <div className="text-[10px] text-muted-foreground font-mono break-all leading-relaxed flex-1">
                {filePath}
              </div>
              <div className="flex-shrink-0">
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </div>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
