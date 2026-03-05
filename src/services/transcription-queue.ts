import type { TranscriptionTask } from "@/types";

function normalizeMaxConcurrentTasks(maxConcurrentTasks: number): number {
  if (!Number.isFinite(maxConcurrentTasks)) {
    return 1;
  }

  return Math.max(1, Math.trunc(maxConcurrentTasks));
}

function hasValidTaskPath(task: Pick<TranscriptionTask, "filePath">): boolean {
  return typeof task.filePath === "string" && task.filePath.trim().length > 0;
}

function isQueueBlockingProcessingTask(task: TranscriptionTask): boolean {
  if (task.status !== "processing") {
    return false;
  }

  // Guard against inconsistent persisted state.
  // Archived/broken processing entries should not block new queued tasks forever.
  if (task.archived) {
    return false;
  }

  return hasValidTaskPath(task);
}

export function getQueuedTaskIdsToStart(
  tasks: TranscriptionTask[],
  maxConcurrentTasks: number,
): string[] {
  const normalizedMaxConcurrentTasks = normalizeMaxConcurrentTasks(maxConcurrentTasks);
  const processingCount = tasks.filter(isQueueBlockingProcessingTask).length;
  const availableSlots = Math.max(0, normalizedMaxConcurrentTasks - processingCount);

  if (availableSlots === 0) {
    return [];
  }

  return tasks
    .filter((task) => task.status === "queued" && hasValidTaskPath(task))
    .slice(0, availableSlots)
    .map((task) => task.id);
}
