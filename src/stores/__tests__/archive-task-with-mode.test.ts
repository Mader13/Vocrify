import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  copyFile: vi.fn(),
  compressMedia: vi.fn(),
  convertToMp3: vi.fn(),
  deleteFile: vi.fn(),
  getArchiveDir: vi.fn(),
  getFileSize: vi.fn(),
  saveTranscription: vi.fn(),
}));

vi.mock("@/services/storage", () => ({
  saveTranscription: mocks.saveTranscription,
}));

vi.mock("@/services/tauri", () => ({
  copyFile: mocks.copyFile,
  compressMedia: mocks.compressMedia,
  convertToMp3: mocks.convertToMp3,
  deleteFile: mocks.deleteFile,
  getArchiveDir: mocks.getArchiveDir,
  getFileSize: mocks.getFileSize,
}));

import { useTasks } from "@/stores";
import type { TranscriptionTask } from "@/types";

function createTask(overrides: Partial<TranscriptionTask> = {}): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "sample.mp4",
    filePath: "C:/source/sample.mp4",
    fileSize: 2048,
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

function resetStore(task: TranscriptionTask): void {
  useTasks.setState((state) => ({
    ...state,
    tasks: [task],
    archiveSettings: {
      defaultMode: "delete_video",
      compression: "none",
      rememberChoice: true,
      showFileSizes: true,
    },
    selectedTaskId: task.id,
  }));
}

describe("archiveTaskWithMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("vocrify-tasks");
    mocks.saveTranscription.mockResolvedValue({ success: true });
    mocks.getArchiveDir.mockResolvedValue({ success: true, data: "C:/AppData/archive" });
    mocks.getFileSize.mockResolvedValue({ success: true, data: 512 });
    mocks.deleteFile.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    localStorage.removeItem("vocrify-tasks");
    useTasks.setState((state) => ({
      ...state,
      tasks: [],
      selectedTaskId: null,
    }));
  });

  it("archives keep_all tasks only after archive media is created", async () => {
    mocks.copyFile.mockResolvedValue({ success: true, data: "C:/AppData/archive/task-1.mp4" });
    resetStore(createTask({
      managedCopyPath: "C:/Users/test/Videos/task-1.mp4",
      managedCopyStatus: "done",
    }));

    await useTasks.getState().archiveTaskWithMode("task-1", "keep_all");

    const archivedTask = useTasks.getState().tasks[0];
    expect(archivedTask.archived).toBe(true);
    expect(archivedTask.archiveMode).toBe("keep_all");
    expect(archivedTask.filePath).toBe("C:/AppData/archive/task-1.mp4");
    expect(archivedTask.audioPath).toBeUndefined();
    expect(archivedTask.managedCopyPath).toBe("C:/AppData/archive/task-1.mp4");
    expect(mocks.deleteFile).toHaveBeenCalledWith("C:/Users/test/Videos/task-1.mp4");
  });

  it("archives delete_video tasks with archived audio only", async () => {
    mocks.convertToMp3.mockResolvedValue({ success: true, data: "C:/AppData/archive/task-1.mp3" });
    resetStore(createTask({
      managedCopyPath: "C:/Users/test/Music/task-1.m4a",
      managedCopyStatus: "done",
    }));

    await useTasks.getState().archiveTaskWithMode("task-1", "delete_video");

    const archivedTask = useTasks.getState().tasks[0];
    expect(archivedTask.archived).toBe(true);
    expect(archivedTask.archiveMode).toBe("delete_video");
    expect(archivedTask.filePath).toBeUndefined();
    expect(archivedTask.audioPath).toBe("C:/AppData/archive/task-1.mp3");
    expect(archivedTask.managedCopyPath).toBe("C:/AppData/archive/task-1.mp3");
  });

  it("does not archive task when archive media creation fails", async () => {
    mocks.copyFile.mockResolvedValue({ success: false, error: "copy failed" });
    const originalTask = createTask({
      managedCopyPath: "C:/Users/test/Videos/task-1.mp4",
      managedCopyStatus: "done",
    });
    resetStore(originalTask);

    await expect(useTasks.getState().archiveTaskWithMode("task-1", "keep_all")).rejects.toThrow("copy failed");

    const task = useTasks.getState().tasks[0];
    expect(task.archived).toBeUndefined();
    expect(task.archiveMode).toBeUndefined();
    expect(task.filePath).toBe(originalTask.filePath);
    expect(task.managedCopyPath).toBe(originalTask.managedCopyPath);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });

  it("clears playable media state for text_only archives", async () => {
    resetStore(createTask({
      managedCopyPath: "C:/Users/test/Videos/task-1.mp4",
      managedCopyStatus: "done",
      audioPath: "C:/AppData/archive/task-1.mp3",
    }));

    await useTasks.getState().archiveTaskWithMode("task-1", "text_only");

    const archivedTask = useTasks.getState().tasks[0];
    expect(archivedTask.archived).toBe(true);
    expect(archivedTask.archiveMode).toBe("text_only");
    expect(archivedTask.filePath).toBeUndefined();
    expect(archivedTask.audioPath).toBeUndefined();
    expect(archivedTask.managedCopyPath).toBeUndefined();
    expect(archivedTask.managedCopyStatus).toBeUndefined();
    expect(archivedTask.archiveSize).toBe(0);
    expect(mocks.deleteFile).toHaveBeenCalledWith("C:/Users/test/Videos/task-1.mp4");
  });
});
