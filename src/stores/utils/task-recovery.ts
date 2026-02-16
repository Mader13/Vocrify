import type { TranscriptionTask, TaskStatus } from "@/types";

export const INTERRUPTED_TRANSCRIPTION_ERROR =
  "Транскрипция была прервана: приложение закрылось во время обработки. Запустите задачу повторно.";

export function recoverInterruptedTasks(
  tasks: TranscriptionTask[],
): { tasks: TranscriptionTask[]; recoveredCount: number } {
  let recoveredCount = 0;

  const recoveredTasks = tasks.map((task) => {
    if (task.status !== "processing") {
      return task;
    }

    recoveredCount += 1;

    return {
      ...task,
      status: "failed" as TaskStatus,
      error: INTERRUPTED_TRANSCRIPTION_ERROR,
      completedAt: new Date(),
      streamingSegments: [],
    };
  });

  return {
    tasks: recoveredTasks,
    recoveredCount,
  };
}
