import type { TranscriptionTask } from "@/types";

export function getQueuedTaskIdsToStart(
  tasks: TranscriptionTask[],
  maxConcurrentTasks: number,
): string[] {
  const processingCount = tasks.filter((task) => task.status === "processing").length;
  const availableSlots = Math.max(0, maxConcurrentTasks - processingCount);

  if (availableSlots === 0) {
    return [];
  }

  return tasks
    .filter((task) => task.status === "queued" && !!task.filePath)
    .slice(0, availableSlots)
    .map((task) => task.id);
}
