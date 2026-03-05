import { describe, expect, it } from "vitest";

import type { TranscriptionTask } from "@/types";
import { getStoredMediaPathsForDeletion } from "@/stores/utils/task-media-cleanup";

function createTask(overrides: Partial<TranscriptionTask>): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "sample.mp4",
    filePath: "C:/source/sample.mp4",
    fileSize: 1024,
    status: "completed",
    progress: 100,
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
    createdAt: new Date("2026-03-02T10:00:00.000Z"),
    startedAt: null,
    completedAt: new Date("2026-03-02T10:05:00.000Z"),
    ...overrides,
  };
}

describe("getStoredMediaPathsForDeletion", () => {
  it("returns managed copy for non-archived task", () => {
    const task = createTask({
      archived: false,
      managedCopyPath: "C:/storage/task-1.mp4",
    });

    expect(getStoredMediaPathsForDeletion(task)).toEqual(["C:/storage/task-1.mp4"]);
  });

  it("returns managed and keep_all archive paths", () => {
    const task = createTask({
      archived: true,
      archiveMode: "keep_all",
      filePath: "C:/archive/task-1.mp4",
      managedCopyPath: "C:/storage/task-1.mp4",
    });

    expect(getStoredMediaPathsForDeletion(task)).toEqual([
      "C:/storage/task-1.mp4",
      "C:/archive/task-1.mp4",
    ]);
  });

  it("returns managed and delete_video archive paths", () => {
    const task = createTask({
      archived: true,
      archiveMode: "delete_video",
      audioPath: "C:/archive/task-1.mp3",
      managedCopyPath: "C:/storage/task-1.mp3",
    });

    expect(getStoredMediaPathsForDeletion(task)).toEqual([
      "C:/storage/task-1.mp3",
      "C:/archive/task-1.mp3",
    ]);
  });

  it("deduplicates duplicate paths case-insensitively", () => {
    const task = createTask({
      archived: true,
      archiveMode: "delete_video",
      audioPath: "C:/Storage/Task-1.mp3",
      managedCopyPath: "c:/storage/task-1.mp3",
    });

    expect(getStoredMediaPathsForDeletion(task)).toEqual(["c:/storage/task-1.mp3"]);
  });

  it("does not delete source file for non-archived keep_all metadata", () => {
    const task = createTask({
      archived: false,
      archiveMode: "keep_all",
      filePath: "C:/source/sample.mp4",
    });

    expect(getStoredMediaPathsForDeletion(task)).toEqual([]);
  });
});
