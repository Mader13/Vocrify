import type { TranscriptionTask, TaskStatus } from "@/types";

export const INTERRUPTED_TRANSCRIPTION_ERROR =
  "Transcription was interrupted: the application closed during processing. Please restart the task.";

export function recoverInterruptedTasks(
  tasks: TranscriptionTask[],
): { tasks: TranscriptionTask[]; recoveredCount: number; hasActiveProcessing: boolean } {
  let recoveredCount = 0;
  let hasActiveProcessing = false;

  const recoveredTasks = tasks.map((task) => {
    if (task.status !== "processing") {
      return task;
    }

    hasActiveProcessing = true;
    recoveredCount += 1;

    return {
      ...task,
      status: "interrupted" as TaskStatus,
      error: INTERRUPTED_TRANSCRIPTION_ERROR,
      completedAt: new Date(),
    };
  });

  return {
    tasks: recoveredTasks,
    recoveredCount,
    hasActiveProcessing,
  };
}
