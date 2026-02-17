import { describe, expect, it } from "vitest";

import type { TranscriptionTask } from "@/types";
import { recoverInterruptedTasks } from "@/stores/utils/task-recovery";

function createTask(overrides: Partial<TranscriptionTask>): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "sample.mp4",
    filePath: "C:/tmp/sample.mp4",
    fileSize: 1024,
    status: "queued",
    progress: 0,
    options: {
      model: "whisper-base",
      device: "auto",
      language: "auto",
      enableDiarization: false,
      diarizationProvider: "none",
      numSpeakers: 2,
    },
    result: null,
    error: null,
    createdAt: new Date("2026-02-15T10:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("recoverInterruptedTasks", () => {
  it("marks processing tasks as interrupted after restart", () => {
    const tasks: TranscriptionTask[] = [
      createTask({ id: "p1", status: "processing", startedAt: new Date("2026-02-15T10:01:00.000Z") }),
      createTask({ id: "q1", status: "queued" }),
    ];

    const { tasks: recovered, recoveredCount } = recoverInterruptedTasks(tasks);

    expect(recoveredCount).toBe(1);
    expect(recovered[0].status).toBe("interrupted");
    expect(recovered[0].error).toBeNull();
    expect(recovered[0].completedAt).not.toBeNull();
    expect(recovered[1].status).toBe("queued");
  });

  it("does not alter non-processing tasks", () => {
    const original = createTask({ id: "c1", status: "completed", progress: 100 });
    const { tasks: recovered, recoveredCount } = recoverInterruptedTasks([original]);

    expect(recoveredCount).toBe(0);
    expect(recovered[0]).toEqual(original);
  });
});
