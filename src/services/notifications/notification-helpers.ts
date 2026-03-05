/**
 * Notification Helpers - convenience functions for showing notifications.
 */

import { logger } from "@/lib/logger";
import { showNotificationWithSettings } from "./notification-settings";
import type { NotificationCategory, TaskStatus, TranscriptionTask } from "@/types";
import {
  clearDispatchedNotifications,
  dismissDispatchedNotification,
  updateDispatchedNotification,
  type NotificationUpdate,
} from "./notification-dispatcher";

type NotificationMetadata = { category?: NotificationCategory } & Record<string, unknown>;

// ============================================================================
// Convenience API
// ============================================================================

export function notifySuccess(
  title: string,
  message: string,
  metadata?: NotificationMetadata
): string | null {
  return showNotificationWithSettings({
    type: "success",
    title,
    message,
    category: metadata?.category,
  });
}

export function notifyError(
  title: string,
  message: string,
  metadata?: NotificationMetadata
): string | null {
  return showNotificationWithSettings({
    type: "error",
    title,
    message,
    category: metadata?.category ?? "error",
    duration: 8000,
  });
}

export function notifyWarning(
  title: string,
  message: string,
  metadata?: NotificationMetadata
): string | null {
  return showNotificationWithSettings({
    type: "warning",
    title,
    message,
    category: metadata?.category,
  });
}

export function notifyInfo(
  title: string,
  message: string,
  metadata?: NotificationMetadata
): string | null {
  return showNotificationWithSettings({
    type: "info",
    title,
    message,
    category: metadata?.category ?? "info",
  });
}

export function notifyProgress(
  title: string,
  message: string,
  progress: number,
  metadata?: NotificationMetadata
): string | null {
  return showNotificationWithSettings({
    type: "info",
    title: `${title} (${progress.toFixed(0)}%)`,
    message,
    category: metadata?.category ?? "info",
    duration: null,
    progress,
  });
}

export function updateNotification(
  id: string,
  updates: NotificationUpdate
): void {
  updateDispatchedNotification(id, updates);
}

export function dismissNotification(id: string): void {
  dismissDispatchedNotification(id);
}

export function clearAllNotifications(): void {
  clearDispatchedNotifications();
}

// ============================================================================
// Store Integration Helpers
// ============================================================================

export function emitModelDownloadNotification(
  status: "completed" | "error" | "cancelled" | "started",
  modelName: string,
  error?: string
): void {
  switch (status) {
    case "completed":
      notifySuccess("Model Download Complete", `Model "${modelName}" is ready to use.`, { category: "download", modelName });
      break;
    case "error":
      notifyError("Model Download Failed", `Failed to download "${modelName}": ${error ?? "Unknown error"}`, { category: "error", modelName });
      break;
    case "cancelled":
      notifyInfo("Download Cancelled", `Download of "${modelName}" was cancelled.`, { category: "download", modelName });
      break;
    case "started":
      notifyInfo("Download Started", `Downloading "${modelName}"...`, { category: "download", modelName });
      break;
  }
}

export function emitTranscriptionNotification(
  status: TaskStatus,
  task: TranscriptionTask
): void {
  switch (status) {
    case "completed": {
      const segmentCount = task.result?.segments.length ?? 0;
      notifySuccess(
        "Transcription Complete",
        `Successfully transcribed "${task.fileName}" with ${segmentCount} segments.`,
        { category: "transcription", taskId: task.id, fileName: task.fileName }
      );
      break;
    }
    case "failed":
      notifyError(
        "Transcription Failed",
        `Failed to transcribe "${task.fileName}": ${task.error ?? "Unknown error"}`,
        { category: "transcription", taskId: task.id, fileName: task.fileName }
      );
      break;
    case "cancelled":
      notifyInfo(
        "Transcription Cancelled",
        `Transcription of "${task.fileName}" was cancelled.`,
        { category: "transcription", taskId: task.id, fileName: task.fileName }
      );
      break;
    case "processing":
      break;
  }
}

// ============================================================================
// Global Error Handler Integration
// ============================================================================

export function setupGlobalErrorNotifications(): void {
  window.addEventListener("unhandledrejection", (event) => {
    logger.error("Unhandled promise rejection", { reason: event.reason });
    notifyError("Unexpected Error", event.reason?.message ?? "An unexpected error occurred", { category: "error" });
  });

  window.addEventListener("error", (event) => {
    logger.error("Global error", { message: event.message, filename: event.filename, lineno: event.lineno });
    notifyError("Application Error", event.message ?? "An application error occurred", { category: "error" });
  });

  logger.info("Global error notifications set up");
}
