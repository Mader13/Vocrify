import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { TaskList } from "@/components/features/TaskList";
import { useTasks, useUIStore } from "@/stores";
import type { TranscriptionTask } from "@/types";

function createTask(overrides: Partial<TranscriptionTask> = {}): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "meeting.wav",
    filePath: "C:/tmp/meeting.wav",
    fileSize: 512,
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
    result: {
      segments: [],
      language: "en",
      duration: 1,
    },
    error: null,
    archived: false,
    createdAt: new Date("2026-02-20T10:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("TaskList", () => {
  afterEach(() => {
    act(() => {
      useTasks.setState({ tasks: [] });
      useUIStore.setState({ currentView: "transcription", selectedTaskId: null });
    });
  });

  it("switches to transcription view when a task is selected from models", () => {
    const task = createTask();
    act(() => {
      useTasks.setState({ tasks: [task] });
      useUIStore.setState({ currentView: "models", selectedTaskId: null });
    });

    render(<TaskList />);

    act(() => {
      fireEvent.click(screen.getByText("meeting.wav"));
    });

    expect(useUIStore.getState().selectedTaskId).toBe(task.id);
    expect(useUIStore.getState().currentView).toBe("transcription");
  });
});
