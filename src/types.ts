// Format ID - extensible string type for future formats
export type FormatId = string;

export type ConversionStatus =
  | "pending"
  | "analyzing"
  | "converting"
  | "completed"
  | "error";

export interface FileItem {
  id: string;
  name: string;
  path: string;
  size: number;
  format: FormatId;
  status: ConversionStatus;
  progress: number;
  outputPath?: string;
  outputSize?: number;
  error?: string;
  duration?: number; // for videos, in seconds
  trimStart?: number; // trim start time in seconds
  trimDuration?: number; // trim duration in seconds
}

// Format-specific target sizes in MB
export interface ConversionSettings {
  targetSizes: Record<FormatId, number>;
}

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

export interface ConversionResult {
  success: boolean;
  outputPath?: string;
  outputSize?: number;
  error?: string;
}

export interface TrimRange {
  startTime: number;
  endTime: number;
}

export interface Trim {
  id: number;
  startTime: number;
  endTime: number;
  colorIndex: number;
  name?: string;
}

export interface Marker {
  id: number;
  time: number;
  name?: string;
}

export interface PendingExport {
  id: string;
  sourcePath: string;
  sourceName: string;
  sourceSize: number;
  ranges: TrimRange[];
  duration: number;
  markers?: Marker[];  // For MKV chapter export
}

export type ExportStep = "format" | "size" | "progress";
