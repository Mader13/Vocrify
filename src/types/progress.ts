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
}

export interface ProgressEvent {
  taskId: string;
  progress: number;
  stage: ProgressStage;
  message: string;
  metrics?: ProgressMetrics;
}
