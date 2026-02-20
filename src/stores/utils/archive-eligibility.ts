import type { TaskStatus } from "@/types";

const ARCHIVABLE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "completed",
  "failed",
  "interrupted",
]);

export function canArchiveTask(task: {
  status: TaskStatus;
  archived?: boolean;
}): boolean {
  if (task.archived) {
    return false;
  }

  return ARCHIVABLE_STATUSES.has(task.status);
}
