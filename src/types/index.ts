export * from "./transcription";
export * from "./models";
export * from "./devices";
export * from "./settings";
export * from "./notifications";
export * from "./progress";

export type {
  SetupStep,
  CheckStatus,
  FFmpegCheckResult,
  DeviceCheckResult,
  ModelCheckResult,
  RuntimeCheckResult,
  RuntimeReadinessStatus,
  SetupWizardState,
} from "./setup";

export type WaveformColorMode = "clean" | "speakers";

export type ExportFormat = "txt" | "srt" | "vtt" | "json" | "md";

export type ExportMode = "with_timestamps" | "plain_text";

export interface VideoPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

export interface WaveformRegion {
  start: number;
  end: number;
  color: string;
  id?: string;
}

export interface ThemeColors {
  waveColor: string;
  progressColor: string;
  chartColors: string[];
}

export interface FileMetadata {
  path: string;
  name: string;
  size: number;
  exists: boolean;
}

export interface DialogState {
  open: boolean;
  title: string;
  message: string;
}
