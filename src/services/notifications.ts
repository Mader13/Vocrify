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
  NotificationCategory,
} from "@/types";
import type { UnlistenFn } from "@tauri-apps/api/event";

// ============================================================================
// Notification Store (Zustand)
// ============================================================================

import { create } from "zustand";
import { useTasks, useModelsStore, useUIStore } from "@/stores";
import type { startTranscription } from "@/services/tauri";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  duration?: number; // Auto-dismiss after ms (0 = no auto-dismiss)
  variant?: NotificationType;
  category?: NotificationCategory;
  action?: {
    label: string;
    onClick: () => void;
  };
  metadata?: {
    category?: "model" | "transcription" | "system" | "ffmpeg";
    taskId?: string;
    modelName?: string;
    fileName?: string;
  };
}

interface NotificationState {
  notifications: Notification[];
  settings: NotificationSettings;
  addNotification: (notification: Omit<Notification, "id" | "timestamp">) => string;
  updateSettings: (updates: Partial<NotificationSettings>) => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  clearByType: (type: NotificationType) => void;
  clearByCategory: (category: string) => void;
}

/**
 * Notification store for managing in-app notifications
 */
export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  settings: {
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
  },

  updateSettings: (updates) => {
    set((state) => ({
      settings: { ...state.settings, ...updates },
    }));
  },

  addNotification: (notification) => {
    const id = crypto.randomUUID();
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: new Date(),
      duration: notification.duration ?? 5000, // Default 5 seconds
    };

    set((state) => ({
      notifications: [...state.notifications, newNotification],
    }));

    logger.info("Notification added", {
      type: notification.type,
      title: notification.title,
      category: notification.metadata?.category,
    });

    // Auto-dismiss if duration is set
    if (newNotification.duration && newNotification.duration > 0) {
      setTimeout(() => {
        get().removeNotification(id);
      }, newNotification.duration);
    }

    return id;
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  },

  clearByType: (type) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.type !== type),
    }));
  },

  clearByCategory: (category) => {
    set((state) => ({
      notifications: state.notifications.filter(
        (n) => n.metadata?.category !== category
      ),
    }));
  },
}));

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
    logger.info("Destroying NotificationEmitter");
    this.unlistenFns.forEach((unlisten) => unlisten());
    this.unlistenFns = [];
    this.lastProgressNotification.clear();
    this.initialized = false;
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
    const { addNotification } = useNotificationStore.getState();

    addNotification({
      type: "success",
      title: "Model Download Complete",
      message: `Model "${modelName}" has been successfully downloaded and is ready to use.`,
      duration: 5000,
      metadata: {
        category: "model",
        modelName,
      },
    });

    logger.modelInfo("Model download complete notification sent", { modelName });
  }

  private onModelDownloadError(modelName: string, error: string): void {
    const { addNotification } = useNotificationStore.getState();

    addNotification({
      type: "error",
      title: "Model Download Failed",
      message: `Failed to download model "${modelName}": ${error}`,
      duration: 8000,
      action: {
        label: "Retry",
        onClick: () => this.retryModelDownload(modelName),
      },
      metadata: {
        category: "model",
        modelName,
      },
    });

    logger.modelError("Model download error notification sent", { modelName, error });
  }

  private onModelDownloadStage(stage: {
    modelName: string;
    stage: string;
    submodelName: string;
    percent: number;
  }): void {
    // Only notify on stage completion (100% progress for that stage)
    if (stage.percent === 100) {
      const { addNotification } = useNotificationStore.getState();

      addNotification({
        type: "info",
        title: "Model Download Progress",
        message: `Download stage "${stage.stage}" completed for model "${stage.modelName}".`,
        duration: 3000,
        metadata: {
          category: "model",
          modelName: stage.modelName,
        },
      });
    }
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

    const { addNotification } = useNotificationStore.getState();

    addNotification({
      type: "info",
      title: "FFmpeg Download Progress",
      message: `Downloading FFmpeg: ${progress.percent.toFixed(1)}% (${this.formatBytes(progress.currentBytes)} / ${this.formatBytes(progress.totalBytes)})`,
      duration: 3000,
      metadata: {
        category: "ffmpeg",
      },
    });
  }

  private onFFmpegStatus(status: { status: string; message: string }): void {
    const { addNotification } = useNotificationStore.getState();

    switch (status.status) {
      case "completed":
        addNotification({
          type: "success",
          title: "FFmpeg Installed",
          message: "FFmpeg has been successfully downloaded and installed.",
          duration: 5000,
          metadata: {
            category: "ffmpeg",
          },
        });
        break;

      case "failed":
        addNotification({
          type: "error",
          title: "FFmpeg Installation Failed",
          message: status.message || "Failed to download or install FFmpeg.",
          duration: 8000,
          metadata: {
            category: "ffmpeg",
          },
        });
        break;

      case "extracting":
        addNotification({
          type: "info",
          title: "Installing FFmpeg",
          message: "Extracting FFmpeg binaries...",
          duration: 3000,
          metadata: {
            category: "ffmpeg",
          },
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

    const { addNotification } = useNotificationStore.getState();

    // Get task info for better context
    const task = this.getTaskById(event.taskId);
    const fileName = task?.fileName ?? "Unknown file";

    addNotification({
      type: "info",
      title: this.getTranscriptionStageTitle(event.stage),
      message: `${fileName}: ${event.progress.toFixed(0)}% complete`,
      duration: 3000,
      metadata: {
        category: "transcription",
        taskId: event.taskId,
        fileName,
      },
    });
  }

  private onTranscriptionComplete(taskId: string, result: { segments: any[] }): void {
    const { addNotification } = useNotificationStore.getState();

    const task = this.getTaskById(taskId);
    const fileName = task?.fileName ?? "Unknown file";
    const segmentCount = result.segments?.length ?? 0;

    addNotification({
      type: "success",
      title: "Transcription Complete",
      message: `Successfully transcribed "${fileName}" with ${segmentCount} segments.`,
      duration: 6000,
      action: {
        label: "View",
        onClick: () => this.navigateToTask(taskId),
      },
      metadata: {
        category: "transcription",
        taskId,
        fileName,
      },
    });

    logger.transcriptionInfo("Transcription complete notification sent", { taskId, fileName });
  }

  private onTranscriptionError(taskId: string, error: string): void {
    const { addNotification } = useNotificationStore.getState();

    const task = this.getTaskById(taskId);
    const fileName = task?.fileName ?? "Unknown file";

    addNotification({
      type: "error",
      title: "Transcription Failed",
      message: `Failed to transcribe "${fileName}": ${error}`,
      duration: 10000,
      action: {
        label: "Retry",
        onClick: () => this.retryTranscription(taskId),
      },
      metadata: {
        category: "transcription",
        taskId,
        fileName,
      },
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

  private retryModelDownload(modelName: string): void {
    // Trigger model download retry
    const { useModelsStore } = require("@/stores");
    const model = useModelsStore.getState().availableModels.find(
      (m: any) => m.name === modelName
    );
    if (model) {
      useModelsStore.getState().downloadModel(modelName, model.type);
    }
  }

  private retryTranscription(taskId: string): void {
    // Trigger transcription retry
    const task = this.getTaskById(taskId);
    if (task) {
      const { startTranscription } = require("@/services/tauri");
      startTranscription(task.id, task.filePath, task.options);
    }
  }

  private navigateToTask(taskId: string): void {
    // Navigate to the task view
    const { useUIStore } = require("@/stores");
    useUIStore.getState().setSelectedTask(taskId);
    useUIStore.getState().setCurrentView("transcription");
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
  metadata?: Notification["metadata"]
): string {
  const { addNotification } = useNotificationStore.getState();
  return addNotification({
    type: "success",
    title,
    message,
    metadata,
  });
}

/**
 * Show an error notification
 */
export function notifyError(
  title: string,
  message: string,
  metadata?: Notification["metadata"]
): string {
  const { addNotification } = useNotificationStore.getState();
  return addNotification({
    type: "error",
    title,
    message,
    duration: 8000,
    metadata,
  });
}

/**
 * Show a warning notification
 */
export function notifyWarning(
  title: string,
  message: string,
  metadata?: Notification["metadata"]
): string {
  const { addNotification } = useNotificationStore.getState();
  return addNotification({
    type: "warning",
    title,
    message,
    metadata,
  });
}

/**
 * Show an info notification
 */
export function notifyInfo(
  title: string,
  message: string,
  metadata?: Notification["metadata"]
): string {
  const { addNotification } = useNotificationStore.getState();
  return addNotification({
    type: "info",
    title,
    message,
    metadata,
  });
}

/**
 * Show a progress notification for long-running operations
 */
export function notifyProgress(
  title: string,
  message: string,
  progress: number,
  metadata?: Notification["metadata"]
): string {
  const { addNotification } = useNotificationStore.getState();
  return addNotification({
    type: "info",
    title: `${title} (${progress.toFixed(0)}%)`,
    message,
    duration: 0, // Don't auto-dismiss progress notifications
    metadata,
  });
}

/**
 * Update an existing notification
 */
export function updateNotification(
  id: string,
  updates: Partial<Omit<Notification, "id" | "timestamp">>
): void {
  const { notifications } = useNotificationStore.getState();
  const index = notifications.findIndex((n) => n.id === id);

  if (index !== -1) {
    const updated = {
      ...notifications[index],
      ...updates,
    };

    useNotificationStore.setState((state) => ({
      notifications: [
        ...state.notifications.slice(0, index),
        updated,
        ...state.notifications.slice(index + 1),
      ],
    }));
  }
}

/**
 * Dismiss a notification
 */
export function dismissNotification(id: string): void {
  useNotificationStore.getState().removeNotification(id);
}

/**
 * Clear all notifications
 */
export function clearAllNotifications(): void {
  useNotificationStore.getState().clearAll();
}

// ============================================================================
// React Hook for Notifications
// ============================================================================

/**
 * React hook for accessing notifications
 * Usage:
 * ```tsx
 * const { notifications, addNotification, removeNotification } = useNotifications();
 * ```
 */
export function useNotifications() {
  return useNotificationStore();
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
