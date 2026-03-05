import type { DeviceType } from "./devices";
import type { AIModel } from "./models";
import type { Language } from "./transcription";

export type DiarizationProvider = "none" | "native" | "sherpa-onnx";

export type EnginePreference = "auto" | "rust";

export type AppLocale = "en" | "ru";

export type AppTheme = "light" | "dark" | "system";

export type CloseBehavior = "hide_to_tray" | "exit";

export const APP_LOCALE_NAMES: Record<AppLocale, string> = {
  en: "English",
  ru: "Русский",
};

export type ArchiveCompression = "none" | "light" | "medium" | "heavy";

export type ArchiveMode = "keep_all" | "delete_video" | "text_only";

export type ManagedCopyLifecycle = "on_complete" | "on_archive";

export type AudioProfile = "standard" | "noisy";

export const AUDIO_PROFILE_LABELS: Record<AudioProfile, { name: string; description: string }> = {
  standard: {
    name: "Standard",
    description: "Balanced for clear recordings and general use",
  },
  noisy: {
    name: "Noisy / Windy Environment",
    description: "Filters wind rumble and suppresses background noise",
  },
};

export const ARCHIVE_COMPRESSION_LABELS: Record<ArchiveCompression, string> = {
  none: "No compression",
  light: "Light (high quality)",
  medium: "Medium (balanced)",
  heavy: "Heavy (small size)",
};

export interface AppSettings {
  defaultModel: AIModel;
  defaultDevice: DeviceType;
  defaultLanguage: Language;
  theme: AppTheme;
  language: AppLocale;
  enableDiarization: boolean;
  diarizationProvider: DiarizationProvider;
  closeBehavior: CloseBehavior;
  maxConcurrentTasks: number;
  outputDirectory: string;
  managedCopyEnabled: boolean;
  managedCopyDirectory: string;
  managedCopyCompression: ArchiveCompression;
  managedCopyLifecycle: ManagedCopyLifecycle;
  lastDiarizationProvider: DiarizationProvider;
  enginePreference: EnginePreference;
  autoSave: boolean;
  exportFormat: string;
  numSpeakers: number;
  audioProfile: AudioProfile;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: "whisper-base",
  defaultDevice: "auto",
  defaultLanguage: "auto",
  theme: "system",
  language: "en",
  enableDiarization: false,
  diarizationProvider: "none",
  closeBehavior: "hide_to_tray",
  maxConcurrentTasks: 3,
  outputDirectory: "",
  managedCopyEnabled: true,
  managedCopyDirectory: "",
  managedCopyCompression: "medium",
  managedCopyLifecycle: "on_complete",
  lastDiarizationProvider: "none",
  enginePreference: "auto",
  autoSave: true,
  exportFormat: "txt",
  numSpeakers: 2,
  audioProfile: "standard",
};

export const ENGINE_PREFERENCES: Record<EnginePreference, { name: string; description: string }> = {
  auto: {
    name: "Auto (Recommended)",
    description: "Rust transcribe-rs with Sherpa-ONNX diarization",
  },
  rust: {
    name: "Rust Only",
    description: "Rust transcribe-rs only, error if unavailable",
  },
};

export const DIARIZATION_PROVIDERS: Record<DiarizationProvider, { name: string; description: string; requirements: string }> = {
  none: {
    name: "Disabled",
    description: "No speaker diarization",
    requirements: "None",
  },
  native: {
    name: "Native (Rust)",
    description: "Built-in sherpa-rs diarization",
    requirements: "No additional runtime required",
  },
  "sherpa-onnx": {
    name: "Sherpa-ONNX (legacy alias)",
    description: "Mapped to native Rust diarization",
    requirements: "Compatibility mode",
  },
};

export interface ArchiveSettings {
  defaultMode: ArchiveMode;
  compression: ArchiveCompression;
  rememberChoice: boolean;
  showFileSizes: boolean;
}

export const DEFAULT_ARCHIVE_SETTINGS: ArchiveSettings = {
  defaultMode: "delete_video",
  compression: "none",
  rememberChoice: true,
  showFileSizes: true,
};

/**
 * Performance configuration for controlling feature flags
 * These settings control various performance optimizations in the application
 */
export interface PerformanceConfig {
  /** Enable fast setup check (skip full readiness evaluation if recently verified) */
  fastSetupCheckEnabled: boolean;
  /** Enable lazy TranscriptionManager initialization */
  lazyManagerInitEnabled: boolean;
  /** Enable deferred device detection (only detect when needed) */
  deferDeviceDetectionEnabled: boolean;
  /** Number of days setup cache is considered valid */
  setupCacheTtlDays: number;
}

export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  fastSetupCheckEnabled: true,
  lazyManagerInitEnabled: true,
  deferDeviceDetectionEnabled: true,
  setupCacheTtlDays: 7,
};
