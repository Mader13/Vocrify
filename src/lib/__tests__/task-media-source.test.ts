import { describe, expect, it } from "vitest";

import { resolveTaskMediaSource } from "@/lib/task-media-source";
import type { TranscriptionTask } from "@/types";

function createTask(overrides: Partial<TranscriptionTask> = {}): TranscriptionTask {
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
      audioProfile: "standard",
    },
    result: {
      segments: [],
      language: "en",
      duration: 0,
    },
    error: null,
    createdAt: new Date("2026-03-12T00:00:00.000Z"),
    startedAt: new Date("2026-03-12T00:00:01.000Z"),
    completedAt: new Date("2026-03-12T00:00:02.000Z"),
    ...overrides,
  };
}

describe("resolveTaskMediaSource", () => {
  it("prefers managed copy for active tasks", () => {
    const resolved = resolveTaskMediaSource(createTask({
      managedCopyPath: "C:/managed/sample.mp4",
      managedCopyStatus: "done",
    }));

    expect(resolved.path).toBe("C:/managed/sample.mp4");
    expect(resolved.origin).toBe("managed_copy");
    expect(resolved.mediaKind).toBe("video");
  });

  it("uses only archived filePath for keep_all tasks", () => {
    const resolved = resolveTaskMediaSource(createTask({
      archived: true,
      archiveMode: "keep_all",
      filePath: "C:/archive/task-1.mp4",
      managedCopyPath: "C:/managed/sample.mp4",
      managedCopyStatus: "done",
    }));

    expect(resolved.path).toBe("C:/archive/task-1.mp4");
    expect(resolved.origin).toBe("archive_file");
    expect(resolved.mediaKind).toBe("video");
  });

  it("uses only archived audioPath for delete_video tasks", () => {
    const resolved = resolveTaskMediaSource(createTask({
      archived: true,
      archiveMode: "delete_video",
      filePath: undefined,
      audioPath: "C:/archive/task-1.mp3",
      managedCopyPath: "C:/managed/sample.mp4",
      managedCopyStatus: "done",
    }));

    expect(resolved.path).toBe("C:/archive/task-1.mp3");
    expect(resolved.origin).toBe("archive_audio");
    expect(resolved.mediaKind).toBe("audio");
  });

  it("returns no media for text_only archives", () => {
    const resolved = resolveTaskMediaSource(createTask({
      archived: true,
      archiveMode: "text_only",
      filePath: "C:/source/sample.mp4",
      audioPath: "C:/archive/task-1.mp3",
      managedCopyPath: "C:/managed/sample.mp4",
      managedCopyStatus: "done",
    }));

    expect(resolved.path).toBeUndefined();
    expect(resolved.origin).toBe("none");
    expect(resolved.mediaKind).toBe("none");
    expect(resolved.hasPlayableMedia).toBe(false);
  });
});
