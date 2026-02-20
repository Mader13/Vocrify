export type ProgressStage =
  | "loading"
  | "downloading"
  | "transcribing"
  | "diarizing"
  | "finalizing"
  | "ready";

export interface ProgressMetrics {
  realtimeFactor?: number;
  processedDuration?: number;
  totalDuration?: number;
  estimatedTimeRemaining?: number;
  gpuUsage?: number;
  cpuUsage?: number;
  memoryUsage?: number;
  modelLoadMs?: number;
  decodeMs?: number;
  inferenceMs?: number;
  diarizationMs?: number;
  totalMs?: number;
}

export interface ProgressEvent {
  taskId: string;
  progress: number;
  stage: ProgressStage;
  message: string;
  metrics?: ProgressMetrics;
}
