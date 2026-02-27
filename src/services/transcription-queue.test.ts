import { describe, expect, it } from "vitest";

import type { TranscriptionTask } from "@/types";
import { getQueuedTaskIdsToStart } from "@/services/transcription-queue";

function createTask(overrides: Partial<TranscriptionTask>): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "sample.wav",
    filePath: "C:/tmp/sample.wav",
    fileSize: 100,
    status: "queued",
    progress: 0,
    options: {
      model: "whisper-base",
      device: "cpu",
      language: "auto",
      enableDiarization: false,
      diarizationProvider: "none",
      numSpeakers: -1,
    },
    result: null,
    error: null,
    createdAt: new Date("2026-02-20T10:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("getQueuedTaskIdsToStart", () => {
  it("respects maxConcurrentTasks and starts only available queued slots", () => {
    const tasks: TranscriptionTask[] = [
      createTask({ id: "p1", status: "processing" }),
      createTask({ id: "p2", status: "processing" }),
      createTask({ id: "q1", status: "queued" }),
      createTask({ id: "q2", status: "queued" }),
      createTask({ id: "q3", status: "queued" }),
    ];

    const startIds = getQueuedTaskIdsToStart(tasks, 3);
    expect(startIds).toEqual(["q1"]);
  });

  it("defaults to one slot when maxConcurrentTasks is NaN", () => {
    const tasks: TranscriptionTask[] = [
      createTask({ id: "q1", status: "queued" }),
      createTask({ id: "q2", status: "queued" }),
    ];

    const startIds = getQueuedTaskIdsToStart(tasks, Number.NaN);
    expect(startIds).toEqual(["q1"]);
  });

  it("clamps maxConcurrentTasks to at least one", () => {
    const tasks: TranscriptionTask[] = [
      createTask({ id: "q1", status: "queued" }),
      createTask({ id: "q2", status: "queued" }),
    ];

    const startIds = getQueuedTaskIdsToStart(tasks, 0);
    expect(startIds).toEqual(["q1"]);
  });
});
