export type ConversionType = "video" | "webp";

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
  type: ConversionType;
  status: ConversionStatus;
  progress: number;
  outputPath?: string;
  outputSize?: number;
  error?: string;
  duration?: number; // for videos, in seconds
}

export interface ConversionSettings {
  videoTargetMB: number;
  webpTargetMB: number;
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
}
