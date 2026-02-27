import type { TranscriptionTask } from "@/types";

function normalizeMaxConcurrentTasks(maxConcurrentTasks: number): number {
  if (!Number.isFinite(maxConcurrentTasks)) {
    return 1;
  }

  return Math.max(1, Math.trunc(maxConcurrentTasks));
}

export function getQueuedTaskIdsToStart(
  tasks: TranscriptionTask[],
  maxConcurrentTasks: number,
): string[] {
  const normalizedMaxConcurrentTasks = normalizeMaxConcurrentTasks(maxConcurrentTasks);
  const processingCount = tasks.filter((task) => task.status === "processing").length;
  const availableSlots = Math.max(0, normalizedMaxConcurrentTasks - processingCount);

  if (availableSlots === 0) {
    return [];
  }

  return tasks
    .filter((task) => task.status === "queued" && !!task.filePath)
    .slice(0, availableSlots)
    .map((task) => task.id);
}
