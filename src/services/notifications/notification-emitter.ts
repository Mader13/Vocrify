/**
 * Notification Emitter
 *
 * Listens to backend events (Tauri) and triggers UI toast notifications.
 */

import { logger } from "@/lib/logger";
import { useTasks } from "@/stores";
import type { FFmpegProgress } from "@/services/tauri";
import type {
  ProgressEvent,
  TranscriptionTask,
} from "@/types";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useNotificationStore as useUINotificationStore } from "@/components/ui/notifications";

// ============================================================================
// Types
// ============================================================================

export interface NotificationEmitterConfig {
  enableModelNotifications: boolean;
  enableTranscriptionNotifications: boolean;
  enableErrorNotifications: boolean;
}

const DEFAULT_CONFIG: NotificationEmitterConfig = {
  enableModelNotifications: true,
  enableTranscriptionNotifications: true,
  enableErrorNotifications: true,
};

// ============================================================================
// NotificationEmitter class
// ============================================================================

export class NotificationEmitter {
  private config: NotificationEmitterConfig;
  private unlistenFns: UnlistenFn[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private destroyRequested = false;

  constructor(config: Partial<NotificationEmitterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn("NotificationEmitter already initialized");
      return;
    }

    if (this.initPromise) {
      logger.info("NotificationEmitter initialization already in progress");
      await this.initPromise;
      return;
    }

    logger.info("Initializing NotificationEmitter", this.config);
    this.destroyRequested = false;

    this.initPromise = (async () => {
      const pendingUnlistenFns: UnlistenFn[] = [];
      try {
        const {
          onModelDownloadComplete,
          onModelDownloadError,
          onModelDownloadStage,
          onFFmpegProgress,
          onFFmpegStatus,
          onProgressUpdate,
          onTranscriptionComplete,
          onTranscriptionError,
        } = await import("@/services/tauri");

        if (this.config.enableModelNotifications) {
          pendingUnlistenFns.push(
            await onModelDownloadComplete((modelName) =>
              this.onModelDownloadComplete(modelName)
            )
          );

          pendingUnlistenFns.push(
            await onModelDownloadError((modelName, error) =>
              this.onModelDownloadError(modelName, error)
            )
          );

          pendingUnlistenFns.push(
            await onModelDownloadStage((stage) =>
              this.onModelDownloadStage(stage)
            )
          );
        }

        pendingUnlistenFns.push(
          await onFFmpegProgress((progress) =>
            this.onFFmpegProgress(progress)
          )
        );

        pendingUnlistenFns.push(
          await onFFmpegStatus((status) =>
            this.onFFmpegStatus(status)
          )
        );

        if (this.config.enableTranscriptionNotifications) {
          pendingUnlistenFns.push(
            await onProgressUpdate((event) =>
              this.onTranscriptionProgress(event)
            )
          );

          pendingUnlistenFns.push(
            await onTranscriptionComplete((taskId, result) =>
              this.onTranscriptionComplete(taskId, result)
            )
          );

          pendingUnlistenFns.push(
            await onTranscriptionError((taskId, error) =>
              this.onTranscriptionError(taskId, error)
            )
          );
        }

        if (this.destroyRequested) {
          pendingUnlistenFns.forEach((unlisten) => unlisten());
          logger.info("NotificationEmitter initialization cancelled by destroy request");
          return;
        }

        this.unlistenFns = pendingUnlistenFns;
        this.initialized = true;
        logger.info("NotificationEmitter initialized successfully");
      } catch (error) {
        pendingUnlistenFns.forEach((unlisten) => unlisten());
        logger.error("Failed to initialize NotificationEmitter", { error });
        throw error;
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  destroy(): void {
    this.destroyRequested = true;

    if (!this.initialized && this.unlistenFns.length === 0 && !this.initPromise) {
      logger.warn("NotificationEmitter already destroyed or not initialized");
      notificationEmitterInstance = null;
      return;
    }
    logger.info("Destroying NotificationEmitter");
    this.unlistenFns.forEach((unlisten) => unlisten());
    this.unlistenFns = [];
    this.initialized = false;
    notificationEmitterInstance = null;
  }

  updateConfig(config: Partial<NotificationEmitterConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info("NotificationEmitter config updated", this.config);
  }

  // -- Model Download Handlers -----------------------------------------------

  private onModelDownloadComplete(modelName: string): void {
    logger.modelInfo("onModelDownloadComplete called", { modelName });
    const uiStore = useUINotificationStore.getState();

    uiStore.show({
      type: "success",
      title: "Model Download Complete",
      message: `Model "${modelName}" has been successfully downloaded and is ready to use.`,
      duration: 5000,
    });

    logger.modelInfo("Model download complete notification sent", { modelName });
  }

  private onModelDownloadError(modelName: string, error: string): void {
    const uiStore = useUINotificationStore.getState();

    uiStore.show({
      type: "error",
      title: "Model Download Failed",
      message: `Failed to download model "${modelName}": ${error}`,
      duration: 8000,
    });

    logger.modelError("Model download error notification sent", { modelName, error });
  }

  private onModelDownloadStage(stage: {
    modelName: string;
    stage: string;
    submodelName: string;
    percent: number;
  }): void {
    logger.modelDebug("Download stage progress", { modelName: stage.modelName, stage: stage.stage, percent: stage.percent });
  }

  // -- FFmpeg Handlers --------------------------------------------------------

  private onFFmpegProgress(progress: FFmpegProgress): void {
    logger.info("FFmpeg download progress", {
      percent: progress.percent,
      currentBytes: progress.currentBytes,
      totalBytes: progress.totalBytes,
    });
  }

  private onFFmpegStatus(status: { status: string; message: string }): void {
    const uiStore = useUINotificationStore.getState();

    switch (status.status) {
      case "completed":
        uiStore.show({
          type: "success",
          title: "FFmpeg Installed",
          message: "FFmpeg has been successfully downloaded and installed.",
          duration: 5000,
        });
        break;

      case "failed":
        uiStore.show({
          type: "error",
          title: "FFmpeg Installation Failed",
          message: status.message || "Failed to download or install FFmpeg.",
          duration: 8000,
        });
        break;

      case "extracting":
        uiStore.show({
          type: "info",
          title: "Installing FFmpeg",
          message: "Extracting FFmpeg binaries...",
          duration: 3000,
        });
        break;
    }
  }

  // -- Transcription Handlers -------------------------------------------------

  private onTranscriptionProgress(event: ProgressEvent): void {
    logger.transcriptionDebug("Transcription progress", {
      taskId: event.taskId,
      progress: event.progress,
      stage: event.stage,
    });
  }

  private onTranscriptionComplete(taskId: string, result: { segments: unknown[] }): void {
    const uiStore = useUINotificationStore.getState();

    const task = this.getTaskById(taskId);
    const fileName = task?.fileName ?? "Unknown file";
    const segmentCount = result.segments?.length ?? 0;

    uiStore.show({
      type: "success",
      title: "Transcription Complete",
      message: `Successfully transcribed "${fileName}" with ${segmentCount} segments.`,
      duration: 6000,
    });

    logger.transcriptionInfo("Transcription complete notification sent", { taskId, fileName });
  }

  private onTranscriptionError(taskId: string, error: string): void {
    const uiStore = useUINotificationStore.getState();

    const task = this.getTaskById(taskId);
    if (task?.status === "completed" || task?.status === "cancelled") {
      logger.transcriptionWarn("Ignoring late transcription error notification for finalized task", {
        taskId,
        status: task.status,
        error,
      });
      return;
    }

    const fileName = task?.fileName ?? "Unknown file";

    uiStore.show({
      type: "error",
      title: "Transcription Failed",
      message: `Failed to transcribe "${fileName}": ${error}`,
      duration: 10000,
    });

    logger.transcriptionError("Transcription error notification sent", { taskId, fileName, error });
  }

  // -- Helpers ----------------------------------------------------------------

  private getTaskById(taskId: string): TranscriptionTask | undefined {
    const tasks = useTasks.getState().tasks;
    return tasks.find((t: TranscriptionTask) => t.id === taskId);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let notificationEmitterInstance: NotificationEmitter | null = null;

export function getNotificationEmitter(
  config?: Partial<NotificationEmitterConfig>
): NotificationEmitter {
  if (!notificationEmitterInstance) {
    notificationEmitterInstance = new NotificationEmitter(config);
  }
  return notificationEmitterInstance;
}

export async function initializeNotifications(
  config?: Partial<NotificationEmitterConfig>
): Promise<NotificationEmitter> {
  const emitter = getNotificationEmitter(config);
  await emitter.initialize();
  return emitter;
}

export function destroyNotifications(): void {
  if (!notificationEmitterInstance) {
    return;
  }
  notificationEmitterInstance.destroy();
}
