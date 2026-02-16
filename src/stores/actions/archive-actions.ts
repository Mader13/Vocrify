import type { TranscriptionTask } from "@/types";

export function archiveTaskPure(tasks: TranscriptionTask[], taskId: string): TranscriptionTask[] {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, archived: true } : task
  );
}

export function unarchiveTaskPure(tasks: TranscriptionTask[], taskId: string): TranscriptionTask[] {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, archived: false } : task
  );
}
