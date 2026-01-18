export interface FormatConfig {
  id: string;
  name: string;
  description: string;
  extension: string;
  iconType: string; // FileIcon type prop (e.g., "mp4", "webp", "gif")
  category: string;
  // Size constraints in MB
  sizeMin: number;
  sizeMax: number;
  sizeIncrement: number;
  sizeDefault: number;
}

export interface CategoryConfig {
  id: string;
  name: string;
}

// Category definitions
export const CATEGORIES: CategoryConfig[] = [
  { id: "video", name: "Video" },
  { id: "animated", name: "Animated Image" },
];

// Format configurations - add new formats here
export const FORMATS: Record<string, FormatConfig> = {
  mp4: {
    id: "mp4",
    name: "MP4 (H.264)",
    description: "Best compatibility, widely supported",
    extension: "mp4",
    iconType: "mp4",
    category: "video",
    sizeMin: 5,
    sizeMax: 500,
    sizeIncrement: 5,
    sizeDefault: 25,
  },
  mp4_hevc: {
    id: "mp4_hevc",
    name: "MP4 (H.265)",
    description: "Smaller files, newer devices only",
    extension: "mp4",
    iconType: "mp4",
    category: "video",
    sizeMin: 5,
    sizeMax: 500,
    sizeIncrement: 5,
    sizeDefault: 20,
  },
  mov: {
    id: "mov",
    name: "MOV",
    description: "Apple QuickTime format",
    extension: "mov",
    iconType: "video",
    category: "video",
    sizeMin: 5,
    sizeMax: 500,
    sizeIncrement: 5,
    sizeDefault: 25,
  },
  mkv: {
    id: "mkv",
    name: "MKV",
    description: "Open format, great for archiving",
    extension: "mkv",
    iconType: "mkv",
    category: "video",
    sizeMin: 5,
    sizeMax: 500,
    sizeIncrement: 5,
    sizeDefault: 25,
  },
  webp: {
    id: "webp",
    name: "WebP",
    description: "Small file size, modern format",
    extension: "webp",
    iconType: "webp",
    category: "animated",
    sizeMin: 0.5,
    sizeMax: 50,
    sizeIncrement: 0.5,
    sizeDefault: 3,
  },
  gif: {
    id: "gif",
    name: "GIF",
    description: "Works everywhere, larger files",
    extension: "gif",
    iconType: "gif",
    category: "animated",
    sizeMin: 0.5,
    sizeMax: 50,
    sizeIncrement: 0.5,
    sizeDefault: 5,
  },
};

// Get all format configs
export function getOrderedFormats(): FormatConfig[] {
  return Object.values(FORMATS);
}

// Get formats grouped by category
export function getFormatsByCategory(): { category: CategoryConfig; formats: FormatConfig[] }[] {
  return CATEGORIES.map((category) => ({
    category,
    formats: Object.values(FORMATS).filter((f) => f.category === category.id),
  }));
}

// Get format by ID
export function getFormat(id: string): FormatConfig | undefined {
  return FORMATS[id];
}

// Type for format IDs (derived from FORMATS keys)
export type FormatId = keyof typeof FORMATS;
