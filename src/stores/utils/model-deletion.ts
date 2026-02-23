import type { TranscriptionTask } from "@/types";

const BLOCKING_TASK_STATUSES = new Set<TranscriptionTask["status"]>(["processing"]);

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
