export type AIModel =
  | "whisper-tiny"
  | "whisper-base"
  | "whisper-small"
  | "whisper-medium"
  | "whisper-large-v3-turbo"
  | "parakeet"
  | "parakeet-tdt-0.6b-v3"
  | "sherpa-onnx-diarization";

export type ModelType = "whisper" | "parakeet" | "diarization";

export interface ModelConfig {
  type: "whisper" | "parakeet" | "diarization";
  speedCategory: "fast" | "medium" | "slow";
  supportsStreaming: boolean;
  typicalRealtimeFactor: number;
}

export interface AvailableModel {
  name: string;
  sizeMb: number;
  modelType: ModelType;
  description: string;
  installed: boolean;
  path?: string;
}

export interface LocalModel {
  name: string;
  sizeMb: number;
  modelType: ModelType;
  installed: boolean;
  path?: string;
}

export interface DiskUsage {
  totalSizeMb: number;
  freeSpaceMb: number;
}

export interface ModelDownloadProgress {
  modelName: string;
  currentMb: number;
  totalMb: number;
  percent: number;
  speedMbS: number;
  etaS?: number;
  totalEstimated?: boolean;
  status: "downloading" | "paused" | "completed" | "error" | "cancelled";
  error?: string;
}

export interface ModelDownloadStageEvent {
  modelName: string;
  stage: "segmentation" | "embedding";
  submodelName: string;
  currentMb: number;
  totalMb: number;
  percent: number;
  speedMbS: number;
}

export interface ModelDownloadStageCompleteEvent {
  modelName: string;
  stage: "segmentation" | "embedding";
}

export interface ModelDownloadState {
  modelName: string;
  progress: number;
  currentMb: number;
  totalMb: number;
  speedMbS: number;
  etaS?: number;
  totalEstimated?: boolean;
  status: "downloading" | "paused" | "completed" | "error" | "cancelled";
  error?: string;
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

export const MODEL_NAMES: Record<AIModel, string> = {
  "whisper-tiny": "Whisper Tiny (fastest)",
  "whisper-base": "Whisper Base",
  "whisper-small": "Whisper Small",
  "whisper-medium": "Whisper Medium",
  "whisper-large-v3-turbo": "Whisper Large V3 Turbo (best quality & speed)",
  parakeet: "Parakeet (NVIDIA)",
  "parakeet-tdt-0.6b-v3": "Parakeet 0.6B (multilingual)",
  "sherpa-onnx-diarization": "Sherpa-ONNX Diarization (segmentation and embedding)",
};

export const MODEL_CONFIGS: Record<AIModel, ModelConfig> = {
  "whisper-tiny": { type: "whisper", speedCategory: "fast", supportsStreaming: false, typicalRealtimeFactor: 3.0 },
  "whisper-base": { type: "whisper", speedCategory: "fast", supportsStreaming: false, typicalRealtimeFactor: 2.5 },
  "whisper-small": { type: "whisper", speedCategory: "medium", supportsStreaming: false, typicalRealtimeFactor: 1.8 },
  "whisper-medium": { type: "whisper", speedCategory: "slow", supportsStreaming: true, typicalRealtimeFactor: 1.2 },
  "whisper-large-v3-turbo": { type: "whisper", speedCategory: "medium", supportsStreaming: true, typicalRealtimeFactor: 1.5 },
  parakeet: { type: "parakeet", speedCategory: "fast", supportsStreaming: false, typicalRealtimeFactor: 4.0 },
  "parakeet-tdt-0.6b-v3": { type: "parakeet", speedCategory: "fast", supportsStreaming: false, typicalRealtimeFactor: 4.2 },
  "sherpa-onnx-diarization": { type: "diarization", speedCategory: "fast", supportsStreaming: false, typicalRealtimeFactor: 1.0 },
};

export const AVAILABLE_MODELS: AvailableModel[] = [
  { name: "whisper-tiny", sizeMb: 74, modelType: "whisper", description: "Fastest, minimal accuracy", installed: false },
  { name: "whisper-base", sizeMb: 139, modelType: "whisper", description: "Balance of speed and accuracy", installed: false },
  { name: "whisper-small", sizeMb: 466, modelType: "whisper", description: "Good accuracy, medium speed", installed: false },
  { name: "whisper-medium", sizeMb: 1505, modelType: "whisper", description: "High accuracy", installed: false },
  { name: "whisper-large-v3-turbo", sizeMb: 1610, modelType: "whisper", description: "Maximum accuracy & fast", installed: false },
  { name: "parakeet-tdt-0.6b-v3", sizeMb: 456, modelType: "parakeet", description: "Multilingual including Russian", installed: false },
  { name: "sherpa-onnx-diarization", sizeMb: 45, modelType: "diarization", description: "Sherpa-ONNX diarization model", installed: false },
];

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "whisper-tiny": "Whisper Tiny (74MB)",
  "whisper-base": "Whisper Base (139MB)",
  "whisper-small": "Whisper Small (466MB)",
  "whisper-medium": "Whisper Medium (1.5GB)",
  "whisper-large-v3-turbo": "Whisper Large V3 Turbo (1.6GB)",
  "parakeet-tdt-0.6b-v3": "Parakeet TDT 0.6B (456MB)",
  "sherpa-onnx-reverb-diarization-v1": "Sherpa Reverb Segmentation",
  "sherpa-onnx-embedding": "Sherpa Embedding (3D-Speaker)",
};

export const MODEL_ICONS: Record<ModelType, string> = {
  whisper: "🐍",
  parakeet: "🦜",
  diarization: "🎤",
};

export function isSherpaModel(modelName: string): boolean {
  return modelName.toLowerCase().includes("sherpa-onnx");
}
