/**
 * Notification Service for Transcribe-video
 *
 * Provides centralized notification management for backend-triggered events.
 * Integrates with stores to provide auto-notifications for:
 * - Model download events
 * - Transcription progress events
 * - Error events
 * - FFmpeg download events
 */

import { logger } from "@/lib/logger";
import type { FFmpegProgress } from "@/services/tauri";
import type {
  ProgressEvent,
  TranscriptionTask,
  TaskStatus,
  NotificationSettings,
} from "@/types";
import type { UnlistenFn } from "@tauri-apps/api/event";

// UI Notification Store - used for rendering toast notifications
import { useNotificationStore as useUINotificationStore } from "@/components/ui/notifications";

// ============================================================================
// Notification Settings Store (for NotificationSettings component)
// ============================================================================

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface NotificationSettingsState {
  settings: NotificationSettings;
  updateSettings: (updates: Partial<NotificationSettings>) => void;
  addNotification: (notification: {
    title: string;
    message: string;
    type: "success" | "error" | "warning" | "info";
    category?: string;
  }) => string;
}

const defaultSettings: NotificationSettings = {
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

export const useNotificationStore = create<NotificationSettingsState>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      updateSettings: (updates) => {
        set((state) => ({
          settings: { ...state.settings, ...updates },
        }));
      },
      addNotification: (notification) => {
        const uiStore = useUINotificationStore.getState();
        return uiStore.show({
          type: notification.type,
          title: notification.title,
          message: notification.message,
        });
      },
    }),
    {
      name: "notification-settings",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

// ============================================================================
// Notification Emitter
// ============================================================================

export interface NotificationEmitterConfig {
  enableModelNotifications: boolean;
  enableTranscriptionNotifications: boolean;
  enableErrorNotifications: boolean;
  enableProgressNotifications: boolean;
  enableFFmpegNotifications: boolean;
  progressNotificationInterval: number; // Minimum ms between progress notifications
}

const DEFAULT_CONFIG: NotificationEmitterConfig = {
  enableModelNotifications: true,
  enableTranscriptionNotifications: true,
  enableErrorNotifications: true,
  enableProgressNotifications: true,
  enableFFmpegNotifications: true,
  progressNotificationInterval: 30000, // 30 seconds
};

/**
 * NotificationEmitter - Listens to backend events and triggers notifications
 *
 * This class subscribes to various backend events via Tauri's event system
 * and automatically generates appropriate frontend notifications.
 */
export class NotificationEmitter {
  private config: NotificationEmitterConfig;
  private unlistenFns: UnlistenFn[] = [];
  private lastProgressNotification: Map<string, number> = new Map();
  private initialized = false;

  constructor(config: Partial<NotificationEmitterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the notification emitter and subscribe to all events
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn("NotificationEmitter already initialized");
      return;
    }

    logger.info("Initializing NotificationEmitter", this.config);

    try {
      // Import Tauri services dynamically to avoid circular dependencies
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

      // Model download events
      if (this.config.enableModelNotifications) {
        this.unlistenFns.push(
          await onModelDownloadComplete((modelName) =>
            this.onModelDownloadComplete(modelName)
          )
        );

        this.unlistenFns.push(
          await onModelDownloadError((modelName, error) =>
            this.onModelDownloadError(modelName, error)
          )
        );

        this.unlistenFns.push(
          await onModelDownloadStage((stage) =>
            this.onModelDownloadStage(stage)
          )
        );
      }

      // FFmpeg events
      if (this.config.enableFFmpegNotifications) {
        this.unlistenFns.push(
          await onFFmpegProgress((progress) =>
            this.onFFmpegProgress(progress)
          )
        );

        this.unlistenFns.push(
          await onFFmpegStatus((status) =>
            this.onFFmpegStatus(status)
          )
        );
      }

      // Transcription events
      if (this.config.enableTranscriptionNotifications) {
        this.unlistenFns.push(
          await onProgressUpdate((event) =>
            this.onTranscriptionProgress(event)
          )
        );

        this.unlistenFns.push(
          await onTranscriptionComplete((taskId, result) =>
            this.onTranscriptionComplete(taskId, result)
          )
        );

        this.unlistenFns.push(
          await onTranscriptionError((taskId, error) =>
            this.onTranscriptionError(taskId, error)
          )
        );
      }

      this.initialized = true;
      logger.info("NotificationEmitter initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize NotificationEmitter", { error });
      throw error;
    }
  }

  /**
   * Clean up all event listeners
   */
  destroy(): void {
    if (!this.initialized && this.unlistenFns.length === 0) {
      logger.warn("NotificationEmitter already destroyed or not initialized");
      return;
    }
    logger.info("Destroying NotificationEmitter");
    this.unlistenFns.forEach((unlisten) => unlisten());
    this.unlistenFns = [];
    this.lastProgressNotification.clear();
    this.initialized = false;
    notificationEmitterInstance = null;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<NotificationEmitterConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info("NotificationEmitter config updated", this.config);
  }

  // ------------------------------------------------------------------------
  // Model Download Event Handlers
  // ------------------------------------------------------------------------

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
    // Don't show notifications for individual stage progress - only notify on complete download
    // This avoids showing multiple notifications for multi-stage downloads (e.g., segmentation + embedding)
    logger.modelDebug("Download stage progress", { modelName: stage.modelName, stage: stage.stage, percent: stage.percent });
  }

  // ------------------------------------------------------------------------
  // FFmpeg Event Handlers
  // ------------------------------------------------------------------------

  private onFFmpegProgress(progress: FFmpegProgress): void {
    // Throttle progress notifications
    const now = Date.now();
    const lastNotified = this.lastProgressNotification.get("ffmpeg") ?? 0;

    if (now - lastNotified < this.config.progressNotificationInterval) {
      return;
    }

    this.lastProgressNotification.set("ffmpeg", now);

    const uiStore = useUINotificationStore.getState();

    const message = `Downloading FFmpeg: ${progress.percent.toFixed(1)}% (${this.formatBytes(progress.currentBytes)} / ${this.formatBytes(progress.totalBytes)})`;

    uiStore.show({
      type: "info",
      title: "FFmpeg Download Progress",
      message,
      duration: 3000,
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

  // ------------------------------------------------------------------------
  // Transcription Event Handlers
  // ------------------------------------------------------------------------

  private onTranscriptionProgress(event: ProgressEvent): void {
    if (!this.config.enableProgressNotifications) {
      return;
    }

    // Throttle progress notifications per task
    const now = Date.now();
    const lastNotified = this.lastProgressNotification.get(event.taskId) ?? 0;

    if (now - lastNotified < this.config.progressNotificationInterval) {
      return;
    }

    // Only notify on significant milestones or stage changes
    if (event.progress % 25 !== 0 && event.stage !== "diarizing") {
      return;
    }

    this.lastProgressNotification.set(event.taskId, now);

    const uiStore = useUINotificationStore.getState();

    // Get task info for better context
    const task = this.getTaskById(event.taskId);
    const fileName = task?.fileName ?? "Unknown file";
    const title = this.getTranscriptionStageTitle(event.stage);
    const message = `${fileName}: ${event.progress.toFixed(0)}% complete`;

    uiStore.show({
      type: "info",
      title,
      message,
      duration: 3000,
    });
  }

  private onTranscriptionComplete(taskId: string, result: { segments: any[] }): void {
    const uiStore = useUINotificationStore.getState();

    const task = this.getTaskById(taskId);
    const fileName = task?.fileName ?? "Unknown file";
    const segmentCount = result.segments?.length ?? 0;

    const title = "Transcription Complete";
    const message = `Successfully transcribed "${fileName}" with ${segmentCount} segments.`;

    uiStore.show({
      type: "success",
      title,
      message,
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
    const title = "Transcription Failed";
    const message = `Failed to transcribe "${fileName}": ${error}`;

    uiStore.show({
      type: "error",
      title,
      message,
      duration: 10000,
    });

    logger.transcriptionError("Transcription error notification sent", { taskId, fileName, error });
  }

  // ------------------------------------------------------------------------
  // Helper Methods
  // ------------------------------------------------------------------------

  private getTaskById(taskId: string): TranscriptionTask | undefined {
    // Import dynamically to avoid circular dependency
    const { useTasks } = require("@/stores");
    const tasks = useTasks.getState().tasks;
    return tasks.find((t: TranscriptionTask) => t.id === taskId);
  }

  private getTranscriptionStageTitle(stage: string): string {
    const titles: Record<string, string> = {
      loading: "Loading Model",
      downloading: "Downloading Model",
      transcribing: "Transcribing",
      diarizing: "Detecting Speakers",
      finalizing: "Finalizing",
      ready: "Ready",
    };
    return titles[stage] ?? "Processing";
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let notificationEmitterInstance: NotificationEmitter | null = null;

/**
 * Get or create the singleton NotificationEmitter instance
 */
export function getNotificationEmitter(
  config?: Partial<NotificationEmitterConfig>
): NotificationEmitter {
  if (!notificationEmitterInstance) {
    notificationEmitterInstance = new NotificationEmitter(config);
  }
  return notificationEmitterInstance;
}

/**
 * Initialize the notification service
 * Call this during app initialization
 */
export async function initializeNotifications(
  config?: Partial<NotificationEmitterConfig>
): Promise<NotificationEmitter> {
  const emitter = getNotificationEmitter(config);
  await emitter.initialize();
  return emitter;
}

// ============================================================================
// Convenience API Functions
// ============================================================================

/**
 * Show a success notification
 */
export function notifySuccess(
  title: string,
  message: string,
  _metadata?: Record<string, unknown>
): string {
  const uiStore = useUINotificationStore.getState();

  return uiStore.show({
    type: "success",
    title,
    message,
  });
}

/**
 * Show an error notification
 */
export function notifyError(
  title: string,
  message: string,
  _metadata?: Record<string, unknown>
): string {
  const uiStore = useUINotificationStore.getState();

  return uiStore.show({
    type: "error",
    title,
    message,
    duration: 8000,
  });
}

/**
 * Show a warning notification
 */
export function notifyWarning(
  title: string,
  message: string,
  _metadata?: Record<string, unknown>
): string {
  const uiStore = useUINotificationStore.getState();

  return uiStore.show({
    type: "warning",
    title,
    message,
  });
}

/**
 * Show an info notification
 */
export function notifyInfo(
  title: string,
  message: string,
  _metadata?: Record<string, unknown>
): string {
  const uiStore = useUINotificationStore.getState();

  return uiStore.show({
    type: "info",
    title,
    message,
  });
}

/**
 * Show a progress notification for long-running operations
 */
export function notifyProgress(
  title: string,
  message: string,
  progress: number,
  _metadata?: Record<string, unknown>
): string {
  const uiStore = useUINotificationStore.getState();
  return uiStore.show({
    type: "info",
    title: `${title} (${progress.toFixed(0)}%)`,
    message,
    duration: 0,
  });
}

/**
 * Update an existing notification
 */
export function updateNotification(
  id: string,
  updates: Record<string, unknown>
): void {
  const uiStore = useUINotificationStore.getState();
  uiStore.update(id, updates);
}

/**
 * Dismiss a notification
 */
export function dismissNotification(id: string): void {
  const uiStore = useUINotificationStore.getState();
  uiStore.dismiss(id);
}

/**
 * Clear all notifications
 */
export function clearAllNotifications(): void {
  const uiStore = useUINotificationStore.getState();
  uiStore.clear();
}

// ============================================================================
// React Hook for Notifications
// ============================================================================

/**
 * React hook for accessing notifications
 * Usage:
 * ```tsx
 * const { notifications, success, error, dismiss } = useNotifications();
 * ```
 */
export function useNotifications() {
  return useUINotificationStore();
}

// ============================================================================
// Global Error Handler Integration
// ============================================================================

/**
 * Set up global error handling that shows notifications
 */
export function setupGlobalErrorNotifications(): void {
  // Handle unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    logger.error("Unhandled promise rejection", {
      reason: event.reason,
    });

    notifyError(
      "Unexpected Error",
      event.reason?.message ?? "An unexpected error occurred",
      { category: "system" }
    );
  });

  // Handle global errors
  window.addEventListener("error", (event) => {
    logger.error("Global error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
    });

    notifyError(
      "Application Error",
      event.message ?? "An application error occurred",
      { category: "system" }
    );
  });

  logger.info("Global error notifications set up");
}

// ============================================================================
// Store Integration Helpers
// ============================================================================

/**
 * Hook into modelsStore to emit notifications on state changes
 * Call this from modelsStore when download state changes
 */
export function emitModelDownloadNotification(
  status: "completed" | "error" | "cancelled" | "started",
  modelName: string,
  error?: string
): void {
  switch (status) {
    case "completed":
      notifySuccess(
        "Model Download Complete",
        `Model "${modelName}" is ready to use.`,
        { category: "model", modelName }
      );
      break;

    case "error":
      notifyError(
        "Model Download Failed",
        `Failed to download "${modelName}": ${error ?? "Unknown error"}`,
        { category: "model", modelName }
      );
      break;

    case "cancelled":
      notifyInfo(
        "Download Cancelled",
        `Download of "${modelName}" was cancelled.`,
        { category: "model", modelName }
      );
      break;

    case "started":
      notifyInfo(
        "Download Started",
        `Downloading "${modelName}"...`,
        { category: "model", modelName }
      );
      break;
  }
}

/**
 * Hook into tasksStore to emit notifications on task state changes
 * Call this from tasksStore when task status changes
 */
export function emitTranscriptionNotification(
  status: TaskStatus,
  task: TranscriptionTask
): void {
  switch (status) {
    case "completed":
      const segmentCount = task.result?.segments.length ?? 0;
      notifySuccess(
        "Transcription Complete",
        `Successfully transcribed "${task.fileName}" with ${segmentCount} segments.`,
        {
          category: "transcription",
          taskId: task.id,
          fileName: task.fileName,
        }
      );
      break;

    case "failed":
      notifyError(
        "Transcription Failed",
        `Failed to transcribe "${task.fileName}": ${task.error ?? "Unknown error"}`,
        {
          category: "transcription",
          taskId: task.id,
          fileName: task.fileName,
        }
      );
      break;

    case "cancelled":
      notifyInfo(
        "Transcription Cancelled",
        `Transcription of "${task.fileName}" was cancelled.`,
        {
          category: "transcription",
          taskId: task.id,
          fileName: task.fileName,
        }
      );
      break;

    case "processing":
      // Don't notify on every status change, progress updates handle this
      break;
  }
}
