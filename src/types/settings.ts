export type DiarizationProvider = "none" | "pyannote" | "sherpa-onnx";

export type EnginePreference = "auto" | "rust" | "python";

export type ArchiveMode = "keep_all" | "delete_video" | "text_only";

export interface AppSettings {
  defaultModel: string;
  defaultDevice: string;
  defaultLanguage: string;
  enableDiarization: boolean;
  diarizationProvider: DiarizationProvider;
  maxConcurrentTasks: number;
  outputDirectory: string;
  lastDiarizationProvider: DiarizationProvider;
  enginePreference: EnginePreference;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: "whisper-base",
  defaultDevice: "auto",
  defaultLanguage: "auto",
  enableDiarization: true,
  diarizationProvider: "none",
  maxConcurrentTasks: 2,
  outputDirectory: "",
  lastDiarizationProvider: "none",
  enginePreference: "auto",
};

export const ENGINE_PREFERENCES: Record<EnginePreference, { name: string; description: string }> = {
  auto: {
    name: "Auto (Recommended)",
    description: "Rust transcribe-rs with automatic fallback to Python",
  },
  rust: {
    name: "Rust Only",
    description: "Rust transcribe-rs only, error if unavailable",
  },
  python: {
    name: "Python Only",
    description: "Python engine only (for debugging)",
  },
};

export const DIARIZATION_PROVIDERS: Record<DiarizationProvider, { name: string; description: string; requirements: string }> = {
  none: {
    name: "Disabled",
    description: "No speaker diarization",
    requirements: "None",
  },
  pyannote: {
    name: "PyAnnote",
    description: "High accuracy speaker diarization",
    requirements: "HuggingFace token, 6-8GB VRAM or 16GB RAM",
  },
  "sherpa-onnx": {
    name: "Sherpa-ONNX",
    description: "Lightweight CPU-friendly diarization",
    requirements: "No tokens, <2GB RAM, works on CPU (16kHz)",
  },
};

export interface HuggingFaceToken {
  token: string;
  createdAt: number;
}

export interface ArchiveSettings {
  defaultMode: ArchiveMode;
  rememberChoice: boolean;
  showFileSizes: boolean;
}

export const DEFAULT_ARCHIVE_SETTINGS: ArchiveSettings = {
  defaultMode: "delete_video",
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
