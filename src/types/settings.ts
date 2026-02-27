export type DiarizationProvider = "none" | "native" | "sherpa-onnx";

export type EnginePreference = "auto" | "rust" | "python";

export type AppLocale = "en" | "ru";

export const APP_LOCALE_NAMES: Record<AppLocale, string> = {
  en: "English",
  ru: "Русский",
};

export type ArchiveCompression = "none" | "light" | "medium" | "heavy";

export type ArchiveMode = "keep_all" | "delete_video" | "text_only";

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
  defaultModel: string;
  defaultDevice: string;
  defaultLanguage: string;
  language: AppLocale;
  enableDiarization: boolean;
  diarizationProvider: DiarizationProvider;
  maxConcurrentTasks: number;
  outputDirectory: string;
  lastDiarizationProvider: DiarizationProvider;
  enginePreference: EnginePreference;
  audioProfile: AudioProfile;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: "whisper-base",
  defaultDevice: "auto",
  defaultLanguage: "auto",
  language: "en",
  enableDiarization: true,
  diarizationProvider: "none",
  maxConcurrentTasks: 2,
  outputDirectory: "",
  lastDiarizationProvider: "none",
  enginePreference: "auto",
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
  python: {
    name: "Python Only",
    description: "Deprecated - kept for compatibility",
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
    requirements: "No Python required",
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
