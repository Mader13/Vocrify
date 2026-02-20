import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ProgressEvent,
  SegmentEvent,
  TranscriptionResult,
  ModelDownloadProgress,
  ModelDownloadStageEvent,
  DevicesResponse,
} from "@/types";
import { handleBackendLog } from "./log-handler";
import type { FFmpegProgress, FFmpegStatusEvent } from "./device-commands";

export async function onProgressUpdate(
  callback: (event: ProgressEvent) => void
): Promise<UnlistenFn> {
  return listen<ProgressEvent>("progress-update", (event) => {
    callback(event.payload);
  });
}

export async function onTranscriptionComplete(
  callback: (taskId: string, result: TranscriptionResult) => void
): Promise<UnlistenFn> {
  return listen<{ taskId: string; result: TranscriptionResult }>(
    "transcription-complete",
    (event) => {
      callback(event.payload.taskId, event.payload.result);
    }
  );
}

export async function onTranscriptionError(
  callback: (taskId: string, error: string) => void
): Promise<UnlistenFn> {
  return listen<{ taskId: string; error: string }>(
    "transcription-error",
    (event) => {
      callback(event.payload.taskId, event.payload.error);
    }
  );
}

export async function onSegmentUpdate(
  callback: (event: { taskId: string; segment: SegmentEvent }) => void
): Promise<UnlistenFn> {
  return listen<{ taskId: string; segment: SegmentEvent }>(
    "segment-update",
    (event) => {
      callback(event.payload);
    }
  );
}

export interface TranscriptionTransportHandlers {
  onProgress: (event: ProgressEvent) => void;
  onError: (taskId: string, error: string) => void;
  onSegment: (event: { taskId: string; segment: SegmentEvent }) => void;
}

export async function subscribeToTranscriptionTransportEvents(
  handlers: TranscriptionTransportHandlers,
): Promise<() => void> {
  const [unlistenProgress, unlistenError, unlistenSegment] = await Promise.all([
    onProgressUpdate(handlers.onProgress),
    onTranscriptionError(handlers.onError),
    onSegmentUpdate(handlers.onSegment),
  ]);

  return () => {
    unlistenProgress();
    unlistenError();
    unlistenSegment();
  };
}

export async function onModelDownloadProgress(
  callback: (progress: ModelDownloadProgress) => void
): Promise<UnlistenFn> {
  return listen<ModelDownloadProgress>("model-download-progress", (event) => {
    callback(event.payload);
  });
}

export async function onModelDownloadComplete(
  callback: (modelName: string) => void
): Promise<UnlistenFn> {
  return listen<{ modelName: string }>("model-download-complete", (event) => {
    callback(event.payload.modelName);
  });
}

export async function onModelDownloadError(
  callback: (modelName: string, error: string) => void
): Promise<UnlistenFn> {
  return listen<{ modelName: string; error: string }>(
    "model-download-error",
    (event) => {
      callback(event.payload.modelName, event.payload.error);
    }
  );
}

export async function onModelDownloadRetrying(
  callback: (modelName: string, message: string) => void
): Promise<UnlistenFn> {
  return listen<{ modelName: string; message: string }>(
    "model-download-retrying",
    (event) => {
      callback(event.payload.modelName, event.payload.message);
    }
  );
}

export async function onModelDownloadStage(
  callback: (stage: ModelDownloadStageEvent) => void
): Promise<UnlistenFn> {
  return listen<ModelDownloadStageEvent>("model-download-stage", (event) => {
    callback(event.payload);
  });
}

export async function onModelDownloadStageComplete(
  callback: (modelName: string, stage: string) => void
): Promise<UnlistenFn> {
  return listen<{ modelName: string; stage: string }>(
    "model-download-stage-complete",
    (event) => {
      callback(event.payload.modelName, event.payload.stage);
    }
  );
}

export async function onBackendLogs(
  callback: (logEvent: {
    level: string;
    category: string;
    message: string;
    data?: unknown;
    taskId?: string;
    fileName?: string;
  }) => void
): Promise<UnlistenFn> {
  return listen("backend-log", (event) => {
    const payload = event.payload as {
      level: string;
      category: string;
      message: string;
      data?: unknown;
      taskId?: string;
      fileName?: string;
    };
    handleBackendLog(payload);
    callback(payload);
  });
}

export async function onDevicesDetected(
  callback: (response: DevicesResponse) => void
): Promise<UnlistenFn> {
  return listen<DevicesResponse>("devices-detected", (event) => {
    callback(event.payload);
  });
}

export async function onFFmpegProgress(
  callback: (progress: FFmpegProgress) => void
): Promise<UnlistenFn> {
  return listen<FFmpegProgress>("ffmpeg-download-progress", (event) => {
    callback(event.payload);
  });
}

export async function onFFmpegStatus(
  callback: (status: FFmpegStatusEvent) => void
): Promise<UnlistenFn> {
  return listen<FFmpegStatusEvent>("ffmpeg-status", (event) => {
    callback(event.payload);
  });
}
