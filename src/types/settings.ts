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
    name: "Auto (рекомендуется)",
    description: "Rust transcribe-rs с автоматическим fallback на Python",
  },
  rust: {
    name: "Rust только",
    description: "Только Rust transcribe-rs, ошибка при недоступности",
  },
  python: {
    name: "Python только",
    description: "Только Python движок (для отладки)",
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
