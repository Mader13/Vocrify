import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { z } from "zod";
import type { SpeakerCount } from "@/types";

/**
 * Schema for cached audio peaks data
 */
export const AudioPeaksSchema = z.object({
  peaks: z.array(z.number()),
  timestamp: z.number(),
  ttl: z.number(),
});

// HIGH-10: Schema for log entries validation
export const LogEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  data: z.any().optional(),
});

/**
 * Safe JSON parse function with validation and size limits
 */
export function safeJsonParse<T>(
  data: string,
  schema: z.ZodType<T>
): T | null {
  try {
    // Size limit check (1MB)
    if (data.length > 1_000_000) {
      console.warn("JSON data too large:", data.length);
      return null;
    }

    const parsed = JSON.parse(data);

    // Validate against schema
    return schema.parse(parsed);
  } catch (error) {
    console.warn("Invalid JSON data:", error);
    return null;
  }
}
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format seconds to HH:MM:SS or MM:SS format
 */
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Format file size to human readable format
 */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format size in MB to human readable format (e.g., "1.5 GB" or "500 MB")
 */
export function formatSizeMb(mb: number | undefined | null): string {
  if (mb === undefined || mb === null || !Number.isFinite(mb)) {
    return "N/A";
  }
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${Math.round(mb)} MB`;
}

/**
 * Format ETA in seconds to human readable format (e.g., "2m 30s" or "45s")
 */
export function formatEta(etaS?: number): string | null {
  if (!etaS || etaS <= 0 || !Number.isFinite(etaS)) {
    return null;
  }
  const totalSeconds = Math.round(etaS);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * Get file extension from path
 */
export function getFileExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() || "";
}

/**
 * Check if file is a supported video format
 */
export function isVideoFile(path: string): boolean {
  const videoExtensions = ["mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv"];
  return videoExtensions.includes(getFileExtension(path));
}

/**
 * Check if file is a supported audio format
 */
export function isAudioFile(path: string): boolean {
  const audioExtensions = ["mp3", "wav", "flac", "aac", "ogg", "m4a", "wma"];
  return audioExtensions.includes(getFileExtension(path));
}

/**
 * Check if file is a supported media format (video or audio)
 */
export function isMediaFile(path: string): boolean {
  return isVideoFile(path) || isAudioFile(path);
}

/**
 * Format time for SRT subtitles (HH:MM:SS,mmm)
 */
export function formatSRTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

/**
 * Format time for VTT subtitles (HH:MM:SS.mmm)
 */
export function formatVTTTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

/**
 * Get theme colors from CSS variables
 */
export function getThemeColors(): {
  waveColor: string;
  progressColor: string;
  chartColors: string[];
} {
  const root = document.documentElement;
  const computedStyle = getComputedStyle(root);

  const waveColor = computedStyle.getPropertyValue("--muted").trim() || "#888888";
  const progressColor = computedStyle.getPropertyValue("--primary").trim() || "#3b82f6";

  const chartColors = [
    computedStyle.getPropertyValue("--chart-1").trim() || "#3b82f6",
    computedStyle.getPropertyValue("--chart-2").trim() || "#10b981",
    computedStyle.getPropertyValue("--chart-3").trim() || "#f59e0b",
    computedStyle.getPropertyValue("--chart-4").trim() || "#ef4444",
    computedStyle.getPropertyValue("--chart-5").trim() || "#8b5cf6",
  ];

  return { waveColor, progressColor, chartColors };
}

/**
 * Cache waveform peaks in localStorage (24 hour TTL)
 */
export function cacheWaveformPeaks(filePath: string, peaks: Float32Array): void {
  try {
    const cacheKey = `waveform-peaks-${filePath}`;
    const cacheData = {
      peaks: Array.from(peaks),
      timestamp: Date.now(),
      ttl: 24 * 60 * 60 * 1000, // 24 hours
    };
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
  } catch (error) {
    console.warn("Failed to cache waveform peaks:", error);
  }
}

/**
 * Get cached waveform peaks if still valid
 */
export function getCachedWaveformPeaks(filePath: string): Float32Array | null {
  try {
    const cacheKey = `waveform-peaks-${filePath}`;
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;

    const data = safeJsonParse(cached, AudioPeaksSchema);
    if (!data) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    
    const now = Date.now();
    if (now - data.timestamp > data.ttl) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    return new Float32Array(data.peaks);
  } catch (error) {
    console.warn("Failed to get cached waveform peaks:", error);
    return null;
  }
}

/**
 * Download file with given content and filename
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Get speaker count label for display
 */
export function getSpeakerCountLabel(count: SpeakerCount): string {
  if (count === "auto") return "Auto";
  return count.toString();
}

/**
 * Format date to locale string (DD.MM.YYYY HH:MM)
 */
export function formatDateTime(date: Date | string | number): string {
  const d = new Date(date);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
