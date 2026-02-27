import type { TranscriptionTask } from "@/types";

const BLOCKING_TASK_STATUSES = new Set<TranscriptionTask["status"]>(["processing"]);
export const PENDING_MODEL_DELETIONS_STORAGE_KEY = "vocrify-pending-model-deletions";

export interface PendingModelDeletionState {
  requestedAt: number;
  lastAttemptAt?: number;
  lastError?: string;
}

export function isTaskBlockingModelDeletion(task: TranscriptionTask, modelName: string): boolean {
  return BLOCKING_TASK_STATUSES.has(task.status) && task.options.model === modelName;
}

export function countBlockingTasksForModel(tasks: TranscriptionTask[], modelName: string): number {
  return tasks.reduce((count, task) => {
    if (isTaskBlockingModelDeletion(task, modelName)) {
      return count + 1;
    }

    return count;
  }, 0);
}

export function hasBlockingTasksForModel(tasks: TranscriptionTask[], modelName: string): boolean {
  return tasks.some((task) => isTaskBlockingModelDeletion(task, modelName));
}

export function loadPendingModelDeletions(): Record<string, PendingModelDeletionState> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PENDING_MODEL_DELETIONS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, PendingModelDeletionState>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

export function persistPendingModelDeletions(
  pendingModelDeletions: Record<string, PendingModelDeletionState>,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      PENDING_MODEL_DELETIONS_STORAGE_KEY,
      JSON.stringify(pendingModelDeletions),
    );
  } catch {
    // no-op: storage quota or unavailability should not block transcription flow
  }
}

export function isModelPendingDeletion(modelName: string): boolean {
  return Boolean(loadPendingModelDeletions()[modelName]);
}
