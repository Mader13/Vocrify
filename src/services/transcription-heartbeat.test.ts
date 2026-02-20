import { describe, expect, it } from "vitest";

import type { TranscriptionTask } from "@/types";
import { collectStaleProcessingTaskIds } from "@/services/transcription-heartbeat";

function createTask(overrides: Partial<TranscriptionTask>): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "sample.wav",
    filePath: "C:/tmp/sample.wav",
    fileSize: 100,
    status: "processing",
    progress: 25,
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
    startedAt: new Date("2026-02-20T10:00:05.000Z"),
    completedAt: null,
    ...overrides,
  };
}

describe("transcription heartbeat stale detection", () => {
  it("does not mark task as interrupted when heartbeat was received recently", () => {
    const now = Date.now();
    const tasks = [
      createTask({ id: "alive", lastProgressUpdate: now - 30_000 }),
    ];

    const stale = collectStaleProcessingTaskIds(tasks, now, 120_000);
    expect(stale).toEqual([]);
  });

  it("marks task as stale when heartbeat is missing for too long", () => {
    const now = Date.now();
    const tasks = [
      createTask({ id: "stale", lastProgressUpdate: now - 180_000 }),
    ];

    const stale = collectStaleProcessingTaskIds(tasks, now, 120_000);
    expect(stale).toEqual(["stale"]);
  });
});
