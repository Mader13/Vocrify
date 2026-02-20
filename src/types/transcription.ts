import type { AIModel } from "./models";
import type { DeviceType } from "./devices";
import type { DiarizationProvider, ArchiveMode } from "./settings";
import type { ProgressStage, ProgressMetrics, ProgressEvent } from "./progress";

export type TaskStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "interrupted";

export type Language = "auto" | "en" | "ru" | "es" | "fr" | "de" | "zh" | "ja" | "ko";

export type SpeakerCount = "auto" | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface TranscriptionOptions {
  model: AIModel;
  device: DeviceType;
  language: Language;
  enableDiarization: boolean;
  diarizationProvider?: DiarizationProvider;
  numSpeakers: number;
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  confidence: number;
}

export interface SpeakerTurn {
  start: number;
  end: number;
  speaker: string;
}

export interface TranscriptionResult {
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
  speakerTurns?: SpeakerTurn[];
  speakerSegments?: TranscriptionSegment[];
}

export interface TranscriptionTask {
  id: string;
  filePath?: string;
  fileName: string;
  fileSize: number;
  status: TaskStatus;
  progress: number;
  stage?: ProgressStage;
  options: TranscriptionOptions;
  result: TranscriptionResult | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  metrics?: ProgressMetrics;
  streamingSegments?: TranscriptionSegment[];
  archived?: boolean;
  archivedAt?: Date;
  archiveMode?: ArchiveMode;
  audioPath?: string;
  archiveSize?: number;
  videoDeleted?: boolean;
  lastProgressUpdate?: number;
  speakerNameMap?: Record<string, string>;
}

export interface SegmentEvent {
  type: "segment";
  segment: TranscriptionSegment;
  index: number;
  total: number | null;
}

export type IPCEvent = 
  | SegmentEvent
  | ProgressEvent
  | { type: "result"; segments: TranscriptionSegment[]; language: string; duration: number }
  | { type: "error"; error: string }
  | { type: "debug"; message: string }
  | { type: "ready" | "pong" | "shutdown" }
  | { type: "devices"; devices: unknown[]; recommended: string };

export const LANGUAGE_NAMES: Record<Language, string> = {
  auto: "Auto-detect",
  en: "English",
  ru: "Russian",
  es: "Spanish",
  fr: "French",
  de: "German",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
};
