import type { TranscriptionTask } from "@/types";

function getLastActivityTimestamp(task: TranscriptionTask): number {
  if (typeof task.lastProgressUpdate === "number" && task.lastProgressUpdate > 0) {
    return task.lastProgressUpdate;
  }

  if (task.startedAt instanceof Date) {
    return task.startedAt.getTime();
  }

  return 0;
}

export function collectStaleProcessingTaskIds(
  tasks: TranscriptionTask[],
  now: number,
  staleThresholdMs: number,
): string[] {
  return tasks
    .filter((task) => task.status === "processing")
    .filter((task) => {
      const lastActivity = getLastActivityTimestamp(task);
      return lastActivity > 0 && now - lastActivity > staleThresholdMs;
    })
    .map((task) => task.id);
}
