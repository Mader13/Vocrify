import { afterEach, describe, expect, it } from "vitest";

import type { TranscriptionTask } from "@/types";

import {
  countBlockingTasksForModel,
  hasBlockingTasksForModel,
  isModelPendingDeletion,
  isTaskBlockingModelDeletion,
  PENDING_MODEL_DELETIONS_STORAGE_KEY,
  persistPendingModelDeletions,
} from "./model-deletion";

function createTask(overrides: Partial<TranscriptionTask>): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "sample.wav",
    fileSize: 123,
    status: "queued",
    progress: 0,
    options: {
      model: "whisper-base",
      device: "auto",
      language: "auto",
      enableDiarization: false,
      numSpeakers: -1,
    },
    result: null,
    error: null,
    createdAt: new Date("2026-02-20T00:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PENDING_MODEL_DELETIONS_STORAGE_KEY);
  }
});

describe("model deletion task guards", () => {
  it("treats only processing tasks as blockers", () => {
    const queuedTask = createTask({ status: "queued" });
    const processingTask = createTask({ id: "task-2", status: "processing" });

    expect(isTaskBlockingModelDeletion(queuedTask, "whisper-base")).toBe(false);
    expect(isTaskBlockingModelDeletion(processingTask, "whisper-base")).toBe(true);
  });

  it("ignores completed and failed tasks", () => {
    const completedTask = createTask({ status: "completed" });
    const failedTask = createTask({ id: "task-2", status: "failed" });

    expect(isTaskBlockingModelDeletion(completedTask, "whisper-base")).toBe(false);
    expect(isTaskBlockingModelDeletion(failedTask, "whisper-base")).toBe(false);
  });

  it("counts only blockers for the exact model", () => {
    const tasks: TranscriptionTask[] = [
      createTask({ id: "queued-1", status: "queued", options: { ...createTask({}).options, model: "whisper-base" } }),
      createTask({ id: "processing-1", status: "processing", options: { ...createTask({}).options, model: "whisper-base" } }),
      createTask({ id: "other-model", status: "processing", options: { ...createTask({}).options, model: "parakeet" } }),
      createTask({ id: "completed", status: "completed", options: { ...createTask({}).options, model: "whisper-base" } }),
    ];

    expect(countBlockingTasksForModel(tasks, "whisper-base")).toBe(1);
    expect(hasBlockingTasksForModel(tasks, "whisper-base")).toBe(true);
    expect(hasBlockingTasksForModel(tasks, "whisper-small")).toBe(false);
  });
});

describe("model deletion pending storage", () => {
  it("returns false when model is not scheduled for deletion", () => {
    expect(isModelPendingDeletion("whisper-base")).toBe(false);
  });

  it("returns true when model is scheduled for deletion", () => {
    persistPendingModelDeletions({
      "whisper-base": {
        requestedAt: Date.now(),
      },
    });

    expect(isModelPendingDeletion("whisper-base")).toBe(true);
    expect(isModelPendingDeletion("parakeet")).toBe(false);
  });
});
