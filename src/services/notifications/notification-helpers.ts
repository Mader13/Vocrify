/**
 * Notification Helpers — convenience functions for showing notifications.
 */

import { useNotificationStore as useUINotificationStore } from "@/components/ui/notifications";
import { logger } from "@/lib/logger";
import type { TaskStatus, TranscriptionTask } from "@/types";

// ============================================================================
// Convenience API
// ============================================================================

export function notifySuccess(
  title: string,
  message: string,
  _metadata?: Record<string, unknown>
): string {
  return useUINotificationStore.getState().show({ type: "success", title, message });
}

export function notifyError(
  title: string,
  message: string,
  _metadata?: Record<string, unknown>
): string {
  return useUINotificationStore.getState().show({ type: "error", title, message, duration: 8000 });
}

export function notifyWarning(
  title: string,
  message: string,
  _metadata?: Record<string, unknown>
): string {
  return useUINotificationStore.getState().show({ type: "warning", title, message });
}

export function notifyInfo(
  title: string,
  message: string,
  _metadata?: Record<string, unknown>
): string {
  return useUINotificationStore.getState().show({ type: "info", title, message });
}

export function notifyProgress(
  title: string,
  message: string,
  progress: number,
  _metadata?: Record<string, unknown>
): string {
  return useUINotificationStore.getState().show({
    type: "info",
    title: `${title} (${progress.toFixed(0)}%)`,
    message,
    duration: 0,
  });
}

export function updateNotification(
  id: string,
  updates: Record<string, unknown>
): void {
  useUINotificationStore.getState().update(id, updates);
}

export function dismissNotification(id: string): void {
  useUINotificationStore.getState().dismiss(id);
}

export function clearAllNotifications(): void {
  useUINotificationStore.getState().clear();
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
      notifySuccess("Model Download Complete", `Model "${modelName}" is ready to use.`, { category: "model", modelName });
      break;
    case "error":
      notifyError("Model Download Failed", `Failed to download "${modelName}": ${error ?? "Unknown error"}`, { category: "model", modelName });
      break;
    case "cancelled":
      notifyInfo("Download Cancelled", `Download of "${modelName}" was cancelled.`, { category: "model", modelName });
      break;
    case "started":
      notifyInfo("Download Started", `Downloading "${modelName}"...`, { category: "model", modelName });
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
    notifyError("Unexpected Error", event.reason?.message ?? "An unexpected error occurred", { category: "system" });
  });

  window.addEventListener("error", (event) => {
    logger.error("Global error", { message: event.message, filename: event.filename, lineno: event.lineno });
    notifyError("Application Error", event.message ?? "An application error occurred", { category: "system" });
  });

  logger.info("Global error notifications set up");
}
