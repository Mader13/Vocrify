import { afterEach, describe, expect, it } from "vitest";

import {
  clearLegacyPersistedTasks,
  deleteTranscription,
  loadAllTranscriptions,
  loadLegacyPersistedTasks,
  saveTranscription,
} from "@/services/storage";
import type { TranscriptionTask } from "@/types";

function createTask(overrides: Partial<TranscriptionTask> = {}): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "meeting.wav",
    filePath: "C:/tmp/meeting.wav",
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
      duration: 1,
    },
    error: null,
    createdAt: new Date("2026-02-20T10:00:00.000Z"),
    startedAt: null,
    completedAt: new Date("2026-02-20T10:00:10.000Z"),
    ...overrides,
  };
}

describe("storage service", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("persists and deletes task snapshots in fallback storage", async () => {
    const task = createTask();

    const saveResult = await saveTranscription(task);
    expect(saveResult.success).toBe(true);

    const loadedResult = await loadAllTranscriptions();
    expect(loadedResult.success).toBe(true);
    expect(loadedResult.data).toHaveLength(1);
    expect(loadedResult.data?.[0].id).toBe(task.id);
    expect(loadedResult.data?.[0].createdAt).toBeInstanceOf(Date);

    const deleteResult = await deleteTranscription(task.id);
    expect(deleteResult.success).toBe(true);

    const loadedAfterDelete = await loadAllTranscriptions();
    expect(loadedAfterDelete.success).toBe(true);
    expect(loadedAfterDelete.data).toHaveLength(0);
  });

  it("loads and clears legacy persisted tasks", () => {
    const legacyTask = createTask({ id: "legacy-1", fileName: "legacy.wav" });

    window.localStorage.setItem(
      "vocrify-tasks",
      JSON.stringify({
        state: {
          tasks: [legacyTask],
          settings: { theme: "system" },
        },
        version: 1,
      }),
    );

    const legacyTasks = loadLegacyPersistedTasks();
    expect(legacyTasks).toHaveLength(1);
    expect(legacyTasks[0].id).toBe("legacy-1");
    expect(legacyTasks[0].createdAt).toBeInstanceOf(Date);

    clearLegacyPersistedTasks();

    const stored = window.localStorage.getItem("vocrify-tasks");
    expect(stored).not.toBeNull();

    const parsed = stored ? (JSON.parse(stored) as { state: { tasks: unknown[] } }) : null;
    expect(parsed?.state.tasks).toEqual([]);
  });
});
