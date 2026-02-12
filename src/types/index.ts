/**
 * Task status enum
 */
export type TaskStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

/**
 * AI Model type
 *
 * Distil-Whisper models: 6x faster than Whisper Large V3 with ~1% WER loss
 * - distil-large-v3: Recommended - best balance of speed and accuracy
 * - distil-medium: Faster than large-v3, slightly less accurate
 * - distil-small: Fastest, English only
 */
export type AIModel =
  | "whisper-tiny"
  | "whisper-base"
  | "whisper-small"
  | "whisper-medium"
  | "whisper-large"
  | "distil-small"
  | "distil-medium"
  | "distil-large"
  | "distil-large-v3"
  | "parakeet"
  | "parakeet-tdt-0.6b-v3"
  | "parakeet-tdt-1.1b";

/**
 * Device type for processing
 * - "auto": Automatically select best available device (CUDA > MPS > Vulkan > CPU)
 * - "cpu": Use CPU (always available, slowest)
 * - "cuda": Use NVIDIA GPU with CUDA (fastest, requires NVIDIA GPU)
 * - "mps": Use Apple Silicon GPU via Metal Performance Shaders (Mac M1/M2/M3)
 * - "vulkan": Use GPU via Vulkan (AMD/Intel GPUs)
 */
export type DeviceType = "auto" | "cpu" | "cuda" | "mps" | "vulkan";

/**
 * Information about a compute device
 */
export interface DeviceInfo {
  type: DeviceType;
  name: string;
  available: boolean;
  memoryMb?: number;
  computeCapability?: string;
  isRecommended: boolean;
}

/**
 * Response from get_devices command
 */
export interface DevicesResponse {
  type: "devices";
  devices: DeviceInfo[];
  recommended: DeviceInfo;
}

/**
 * Device display names
 */
export const DEVICE_NAMES: Record<DeviceType, string> = {
  auto: "Auto (рекомендуется)",
  cpu: "CPU (медленно)",
  cuda: "NVIDIA GPU (CUDA)",
  mps: "Apple Silicon (MPS)",
  vulkan: "GPU (Vulkan - AMD/Intel)",
};

/**
 * Device descriptions
 */
export const DEVICE_DESCRIPTIONS: Record<DeviceType, string> = {
  auto: "Автоматический выбор лучшего устройства",
  cpu: "Только процессор, работает везде, но медленно",
  cuda: "NVIDIA видеокарта с CUDA, максимальная скорость",
  mps: "Apple Silicon M1/M2/M3, хорошая производительность на Mac",
  vulkan: "AMD/Intel видеокарта через Vulkan, хорошее ускорение",
};

/**
 * Language options
 */
export type Language = "auto" | "en" | "ru" | "es" | "fr" | "de" | "zh" | "ja" | "ko";

/**
 * Speaker count options for diarization
 */
export type SpeakerCount = "auto" | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Transcription options passed to the AI engine
 */
export interface TranscriptionOptions {
  model: AIModel;
  device: DeviceType;
  language: Language;
  enableDiarization: boolean;
  diarizationProvider?: DiarizationProvider;
  numSpeakers: number;
}

/**
 * A single transcription segment
 */
export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  confidence: number;
}

/**
 * Extended progress metrics from the AI engine
 */
export interface ProgressMetrics {
  realtimeFactor?: number;
  processedDuration?: number;
  totalDuration?: number;
  estimatedTimeRemaining?: number;
  gpuUsage?: number;
  cpuUsage?: number;
  memoryUsage?: number;
}

/**
 * A speaker turn (continuous speech by one speaker)
 */
export interface SpeakerTurn {
  start: number;
  end: number;
  speaker: string;
}

/**
 * Transcription result
 */
export interface TranscriptionResult {
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
  speakerTurns?: SpeakerTurn[];
  speakerSegments?: TranscriptionSegment[];
}

/**
 * A transcription task in the queue
 */
export interface TranscriptionTask {
  id: string;
  filePath: string;
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
}

/**
 * Progress event from Python engine
 * Stages match the Python engine output stages
 */
export type ProgressStage =
  | "loading"      // Model loading
  | "downloading"  // Model downloading
  | "transcribing" // Audio transcription
  | "diarizing"    // Speaker diarization
  | "finalizing"   // Preparing final output
  | "ready";       // Ready to start

export interface ProgressEvent {
  taskId: string;
  progress: number;
  stage: ProgressStage;
  message: string;
  metrics?: ProgressMetrics;
}

/**
 * Model configuration for adaptive progress display
 */
export interface ModelConfig {
  type: "whisper" | "distil-whisper" | "parakeet";
  speedCategory: "fast" | "medium" | "slow";
  supportsStreaming: boolean;
  typicalRealtimeFactor: number;
}

/**
 * Streaming segment event from Python engine
 * Emitted as each transcription segment is completed
 */
export interface SegmentEvent {
  type: "segment";
  segment: TranscriptionSegment;
  index: number;
  total: number | null;  // Total segments if known
}

/**
 * All possible IPC events from Python engine
 */
export type IPCEvent =
  | ProgressEvent
  | SegmentEvent
  | { type: "result"; segments: TranscriptionSegment[]; language: string; duration: number }
  | { type: "error"; error: string }
  | { type: "debug"; message: string }
  | { type: "ready" | "pong" | "shutdown" }
  | DevicesResponse;

/**
 * Application settings
 */
export interface AppSettings {
  defaultModel: AIModel;
  defaultDevice: DeviceType;
  defaultLanguage: Language;
  enableDiarization: boolean;
  diarizationProvider: DiarizationProvider;
  maxConcurrentTasks: number;
  outputDirectory: string | null;
  lastDiarizationProvider: DiarizationProvider;
  enginePreference: EnginePreference;
}

/**
 * Default application settings
 */
export const DEFAULT_SETTINGS: AppSettings = {
  defaultModel: "whisper-base",
  defaultDevice: "auto",  // Auto-select best device (CUDA > MPS > CPU)
  defaultLanguage: "auto",
  enableDiarization: true,
  diarizationProvider: "none",
  maxConcurrentTasks: 2,
  outputDirectory: null,
  lastDiarizationProvider: "none",
  enginePreference: "auto",
};

/**
 * Model display names
 */
export const MODEL_NAMES: Record<AIModel, string> = {
  "whisper-tiny": "Whisper Tiny (fastest)",
  "whisper-base": "Whisper Base",
  "whisper-small": "Whisper Small",
  "whisper-medium": "Whisper Medium",
  "whisper-large": "Whisper Large (best quality)",
  "distil-small": "Distil-Whisper Small (6x faster, EN only)",
  "distil-medium": "Distil-Whisper Medium (6x faster, EN only)",
  "distil-large": "Distil-Whisper Large (6x faster)",
  "distil-large-v3": "Distil-Whisper Large V3 (6x faster, recommended)",
  "parakeet": "Parakeet (NVIDIA)",
  "parakeet-tdt-0.6b-v3": "Parakeet 0.6B (multilingual)",
  "parakeet-tdt-1.1b": "Parakeet 1.1B (English only)",
};

export const MODEL_CONFIGS: Record<AIModel, ModelConfig> = {
  "whisper-tiny": {
    type: "whisper",
    speedCategory: "fast",
    supportsStreaming: false,
    typicalRealtimeFactor: 3.0,
  },
  "whisper-base": {
    type: "whisper",
    speedCategory: "fast",
    supportsStreaming: false,
    typicalRealtimeFactor: 2.5,
  },
  "whisper-small": {
    type: "whisper",
    speedCategory: "medium",
    supportsStreaming: false,
    typicalRealtimeFactor: 1.8,
  },
  "whisper-medium": {
    type: "whisper",
    speedCategory: "slow",
    supportsStreaming: true,
    typicalRealtimeFactor: 1.2,
  },
  "whisper-large": {
    type: "whisper",
    speedCategory: "slow",
    supportsStreaming: true,
    typicalRealtimeFactor: 0.9,
  },
  "distil-small": {
    type: "distil-whisper",
    speedCategory: "fast",
    supportsStreaming: false,
    typicalRealtimeFactor: 4.5,
  },
  "distil-medium": {
    type: "distil-whisper",
    speedCategory: "fast",
    supportsStreaming: false,
    typicalRealtimeFactor: 4.0,
  },
  "distil-large": {
    type: "distil-whisper",
    speedCategory: "fast",
    supportsStreaming: false,
    typicalRealtimeFactor: 3.2,
  },
  "distil-large-v3": {
    type: "distil-whisper",
    speedCategory: "fast",
    supportsStreaming: false,
    typicalRealtimeFactor: 3.4,
  },
  parakeet: {
    type: "parakeet",
    speedCategory: "fast",
    supportsStreaming: false,
    typicalRealtimeFactor: 4.0,
  },
  "parakeet-tdt-0.6b-v3": {
    type: "parakeet",
    speedCategory: "fast",
    supportsStreaming: false,
    typicalRealtimeFactor: 4.2,
  },
  "parakeet-tdt-1.1b": {
    type: "parakeet",
    speedCategory: "medium",
    supportsStreaming: false,
    typicalRealtimeFactor: 2.2,
  },
};

/**
 * Language display names
 */
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

/**
 * Diarization provider type
 */
export type DiarizationProvider = "none" | "pyannote" | "sherpa-onnx";

/**
 * Engine preference for transcription
 * Phase 3: Updated for transcribe-rs
 * - "auto": Rust transcribe-rs primary, Python fallback for diarization (default)
 * - "rust": Only Rust transcribe-rs, error if unavailable
 * - "python": Only Python engine (for debugging)
 */
export type EnginePreference = "auto" | "rust" | "python";

/**
 * Engine preference display names and descriptions
 * Phase 3: Updated for transcribe-rs
 */
export const ENGINE_PREFERENCES: Record<
  EnginePreference,
  { name: string; description: string }
> = {
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

/**
 * HuggingFace token configuration
 */
export interface HuggingFaceToken {
  token: string;
  createdAt: number;
}

/**
 * Helper function to check if a model requires HuggingFace token
 */
export function isPyannoteModel(modelName: string): boolean {
  return modelName.toLowerCase().includes("pyannote");
}

/**
 * Helper function to check if a model is Sherpa-ONNX
 */
export function isSherpaModel(modelName: string): boolean {
  return modelName.toLowerCase().includes("sherpa-onnx");
}

/**
 * Helper function to check if a diarization provider requires token
 */
export function requiresHuggingFaceToken(provider: DiarizationProvider): boolean {
  return provider === "pyannote";
}

/**
 * Diarization provider display names and descriptions
 */
export const DIARIZATION_PROVIDERS: Record<
  DiarizationProvider,
  { name: string; description: string; requirements: string }
> = {
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

/**
 * Model type for model management
 */
export type ModelType = "whisper" | "parakeet" | "diarization";

/**
 * Available model information
 */
export interface AvailableModel {
  name: string;
  sizeMb: number;
  modelType: ModelType;
  description: string;
  installed: boolean;
  path?: string;
}

/**
 * Local model information
 */
export interface LocalModel {
  name: string;
  sizeMb: number;
  modelType: ModelType;
  installed: boolean;
  path?: string;
}

/**
 * Disk usage information
 */
export interface DiskUsage {
  totalSizeMb: number;
  freeSpaceMb: number;
}

/**
 * Model download progress
 */
export interface ModelDownloadProgress {
  modelName: string;
  currentMb: number;
  totalMb: number;
  percent: number;
  speedMbS: number;
  status: "downloading" | "paused" | "completed" | "error" | "cancelled";
  error?: string;
}

/**
 * Model download stage event
 */
export interface ModelDownloadStageEvent {
  modelName: string;
  stage: "segmentation" | "embedding";
  submodelName: string;
  currentMb: number;
  totalMb: number;
  percent: number;
  speedMbS: number;
}

/**
 * Model download stage complete event
 */
export interface ModelDownloadStageCompleteEvent {
  modelName: string;
  stage: "segmentation" | "embedding";
}

/**
 * Model download state
 */
export interface ModelDownloadState {
  modelName: string;
  progress: number;
  currentMb: number;
  totalMb: number;
  speedMbS: string;
  status: "downloading" | "paused" | "completed" | "error" | "cancelled";
  error?: string;
  // Add stage tracking fields
  currentStage?: "segmentation" | "embedding" | null;
  stages?: {
    segmentation?: {
      progress: number;
      currentMb: number;
      totalMb: number;
      completed: boolean;
    };
    embedding?: {
      progress: number;
      currentMb: number;
      totalMb: number;
      completed: boolean;
    };
  };
}

/**
 * List of all available models with metadata
 */
export const AVAILABLE_MODELS: AvailableModel[] = [
  {
    name: "whisper-tiny",
    sizeMb: 74,
    modelType: "whisper",
    description: "Самый быстрый, минимальная точность",
    installed: false,
  },
  {
    name: "whisper-base",
    sizeMb: 150,
    modelType: "whisper",
    description: "Баланс скорости и точности",
    installed: false,
  },
  {
    name: "whisper-small",
    sizeMb: 466,
    modelType: "whisper",
    description: "Хорошая точность, средняя скорость",
    installed: false,
  },
  {
    name: "whisper-medium",
    sizeMb: 1505,
    modelType: "whisper",
    description: "Высокая точность",
    installed: false,
  },
  {
    name: "whisper-large-v3",
    sizeMb: 2960,
    modelType: "whisper",
    description: "Максимальная точность, медленный",
    installed: false,
  },
  {
    name: "distil-small",
    sizeMb: 378,
    modelType: "whisper",
    description: "6x быстрее whisper-large, английский только",
    installed: false,
  },
  {
    name: "distil-medium",
    sizeMb: 756,
    modelType: "whisper",
    description: "6x быстрее whisper-large, английский только",
    installed: false,
  },
  {
    name: "distil-large-v3",
    sizeMb: 1480,
    modelType: "whisper",
    description: "6x быстрее, многоязычный, ~1% потерь точности ⭐",
    installed: false,
  },
  {
    name: "parakeet-tdt-0.6b-v3",
    sizeMb: 640,
    modelType: "parakeet",
    description: "Многоязычная, включая русский",
    installed: false,
  },
  {
    name: "parakeet-tdt-1.1b",
    sizeMb: 2490,
    modelType: "parakeet",
    description: "Английский, высокая точность",
    installed: false,
  },
  {
    name: "pyannote-diarization",
    sizeMb: 463,
    modelType: "diarization",
    description: "PyAnnote модель диаризации (включает segmentation + embedding)",
    installed: false,
  },
  {
    name: "sherpa-onnx-diarization",
    sizeMb: 120,
    modelType: "diarization",
    description: "Sherpa-ONNX модель диаризации (включает segmentation + embedding)",
    installed: false,
  },
];

/**
 * Model display names
 */
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "whisper-tiny": "Whisper Tiny (74MB)",
  "whisper-base": "Whisper Base (150MB)",
  "whisper-small": "Whisper Small (466MB)",
  "whisper-medium": "Whisper Medium (1.5GB)",
  "whisper-large-v3": "Whisper Large V3 (3GB)",
  "distil-small": "Distil-Whisper Small (378MB) ⚡",
  "distil-medium": "Distil-Whisper Medium (756MB) ⚡",
  "distil-large-v3": "Distil-Whisper Large V3 (1.5GB) ⚡⭐",
  "parakeet-tdt-0.6b-v3": "Parakeet TDT 0.6B (640MB)",
  "parakeet-tdt-1.1b": "Parakeet TDT 1.1B (2.5GB)",
  "pyannote-segmentation-3.0": "PyAnnote Segmentation 3.0 (68MB)",
  "pyannote-embedding-3.0": "PyAnnote Embedding 3.0 (395MB)",
  "sherpa-onnx-segmentation": "Sherpa Segmentation (35MB)",
  "sherpa-onnx-embedding": "Sherpa Embedding (85MB)",
};

/**
 * Model icons by type
 */
export const MODEL_ICONS: Record<ModelType, string> = {
  whisper: "🐍",
  parakeet: "🦜",
  diarization: "🎤",
};

/**
 * Waveform color mode type
 */
export type WaveformColorMode = "segments" | "speakers";

/**
 * Export format type
 */
export type ExportFormat = "txt" | "srt" | "vtt" | "json" | "md";

/**
 * Export mode for text-based formats (txt, md)
 * - "with_timestamps": Include timestamps and speakers
 * - "plain_text": Just plain text without timestamps and speakers
 */
export type ExportMode = "with_timestamps" | "plain_text";

/**
 * Video player state
 */
export interface VideoPlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
}

/**
 * Waveform region
 */
export interface WaveformRegion {
  start: number;
  end: number;
  color: string;
  id?: string;
}

/**
 * Theme colors extracted from CSS variables
 */
export interface ThemeColors {
  waveColor: string;
  progressColor: string;
  chartColors: string[];
}

/**
 * File metadata returned from Rust backend
 */
export interface FileMetadata {
  path: string;
  name: string;
  size: number;
  exists: boolean;
}

/**
 * Dialog state for error/info modals
 */
export interface DialogState {
  open: boolean;
  title: string;
  message: string;
}

// Re-export setup wizard types
export type {
  SetupStep,
  CheckStatus,
  PythonCheckResult,
  FFmpegCheckResult,
  DeviceCheckResult,
  ModelCheckResult,
  SetupWizardState,
} from "./setup";

// Notification types
export type NotificationPosition =
  | "top-right"
  | "top-left"
  | "bottom-right"
  | "bottom-left"
  | "top-center"
  | "bottom-center";

export type NotificationDuration = number | "infinite";

export type NotificationCategory = "download" | "transcription" | "error" | "info";

export type NotificationVariant = "success" | "error" | "warning" | "info" | "loading";

export interface Notification {
  id: string;
  type: NotificationVariant;
  title: string;
  message?: string;
  duration?: NotificationDuration;
  category?: NotificationCategory;
  variant?: NotificationVariant;
}

export interface NotificationSettings {
  enabled: boolean;
  position: NotificationPosition;
  duration: NotificationDuration;
  soundEnabled: boolean;
  desktopNotificationsEnabled: boolean;
  categories: Record<NotificationCategory, boolean>;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  position: "top-right",
  duration: 4000,
  soundEnabled: false,
  desktopNotificationsEnabled: false,
  categories: {
    download: true,
    transcription: true,
    error: true,
    info: true,
  },
};

export const NOTIFICATION_POSITION_LABELS: Record<NotificationPosition, string> = {
  "top-right": "Сверху справа",
  "top-left": "Сверху слева",
  "bottom-right": "Снизу справа",
  "bottom-left": "Снизу слева",
  "top-center": "По центру сверху",
  "bottom-center": "По центру снизу",
};

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  download: "Загрузка моделей",
  transcription: "Транскрибация",
  error: "Ошибки",
  info: "Информация",
};

export const NOTIFICATION_CATEGORY_ICONS: Record<NotificationCategory, string> = {
  download: "Download",
  transcription: "FileText",
  error: "AlertCircle",
  info: "Info",
};
