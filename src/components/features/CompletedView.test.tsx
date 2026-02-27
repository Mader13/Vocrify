import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { CompletedView } from "@/components/features/CompletedView";
import { useTasks, useUIStore } from "@/stores";
import type { TranscriptionTask } from "@/types";

vi.mock("@/components/features/VideoPlayer", () => ({
  VideoPlayer: React.forwardRef(function MockVideoPlayer(
    props: { isVideoVisible?: boolean; showControls?: boolean },
    _ref,
  ) {
    return (
      <div
        data-testid="video-player"
        data-is-video-visible={String(Boolean(props.isVideoVisible))}
        data-show-controls={String(Boolean(props.showControls))}
      />
    );
  }),
}));

vi.mock("@/components/features/TranscriptionSegments", () => ({
  TranscriptionSegments: () => <div data-testid="transcription-segments" />,
}));

vi.mock("@/components/features/ArchiveButton", () => ({
  ArchiveButton: () => <button type="button">Archive</button>,
}));

vi.mock("@/components/features/ExportMenu", () => ({
  ExportMenu: () => <button type="button">Export</button>,
}));

vi.mock("@/components/features/SpeakerNamesModal", () => ({
  SpeakerNamesModal: () => null,
}));

vi.mock("@/components/features/completed-view-layout", () => ({
  getCompletedViewLayoutMode: () => "stacked",
  getCompletedViewSplitThreshold: () => 1024,
}));

function createTask(overrides: Partial<TranscriptionTask> = {}): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "video.mp4",
    filePath: "C:/tmp/video.mp4",
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
    result: {
      segments: [{ start: 0, end: 2, text: "hello", speaker: null, confidence: 0.9 }],
      language: "ru",
      duration: 2,
    },
    error: null,
    createdAt: new Date("2026-02-20T10:00:00.000Z"),
    startedAt: new Date("2026-02-20T10:00:01.000Z"),
    completedAt: new Date("2026-02-20T10:00:10.000Z"),
    ...overrides,
  };
}

function resetUiStore() {
  act(() => {
    useUIStore.setState({
      displayMode: "clean",
      isSidebarCollapsed: false,
      completedViewModeByTask: {},
    });
  });
}

describe("CompletedView", () => {
  beforeEach(() => {
    resetUiStore();
  });

  afterEach(() => {
    resetUiStore();
    act(() => {
      useTasks.setState({ tasks: [] });
    });
  });

  it("hides waveform mode selector when speaker data is unavailable", () => {
    const task = createTask();

    render(<CompletedView task={task} />);

    expect(screen.queryByTitle("Show waveform Clean")).not.toBeInTheDocument();
    expect(screen.queryByTitle("No speaker data available")).not.toBeInTheDocument();
  });

  it("shows waveform mode selector when speaker data exists", () => {
    const task = createTask({
      result: {
        segments: [{ start: 0, end: 2, text: "hello", speaker: null, confidence: 0.9 }],
        speakerSegments: [{ start: 0, end: 2, text: "hello", speaker: "SPEAKER_00", confidence: 0.9 }],
        speakerTurns: [{ start: 0, end: 2, speaker: "SPEAKER_00" }],
        language: "ru",
        duration: 2,
      },
    });

    render(<CompletedView task={task} />);

    expect(screen.getByTitle("Show waveform Clean")).toBeInTheDocument();
    expect(screen.getByTitle("Show waveform Speakers")).toBeInTheDocument();
  });

  it("shows waveform and controls in transcript focus mode", () => {
    const task = createTask();

    act(() => {
      useUIStore.setState({
        completedViewModeByTask: {
          [task.id]: "transcript-focus",
        },
      });
    });

    render(<CompletedView task={task} />);

    const player = screen.getByTestId("video-player");
    expect(player).toBeInTheDocument();
    expect(player).toHaveAttribute("data-is-video-visible", "false");
    expect(player).toHaveAttribute("data-show-controls", "true");
  });

  it("allows inline editing for transcription title", () => {
    const task = createTask();
    act(() => {
      useTasks.setState({ tasks: [task] });
    });

    render(<CompletedView task={task} />);

    fireEvent.click(screen.getByTitle("Edit transcription title"));

    const titleInput = screen.getByRole("textbox", { name: "Transcription title" });
    fireEvent.change(titleInput, { target: { value: "Client call - Feb 20" } });
    fireEvent.keyDown(titleInput, { key: "Enter" });

    const updatedTask = useTasks.getState().tasks.find((item) => item.id === task.id);
    expect(updatedTask?.fileName).toBe("Client call - Feb 20");
    expect(screen.queryByRole("textbox", { name: "Transcription title" })).not.toBeInTheDocument();
  });

  it("saves transcription title on blur", () => {
    const task = createTask();
    act(() => {
      useTasks.setState({ tasks: [task] });
    });

    render(<CompletedView task={task} />);

    fireEvent.click(screen.getByTitle("Edit transcription title"));

    const titleInput = screen.getByRole("textbox", { name: "Transcription title" });
    fireEvent.change(titleInput, { target: { value: "Standup notes" } });
    fireEvent.blur(titleInput);

    const updatedTask = useTasks.getState().tasks.find((item) => item.id === task.id);
    expect(updatedTask?.fileName).toBe("Standup notes");
  });

  it("uses motion-safe transition styles for title edit controls", () => {
    const task = createTask();

    render(<CompletedView task={task} />);

    const editButton = screen.getByRole("button", { name: "Edit transcription title" });
    expect(editButton.className).toContain("motion-safe:duration-200");

    fireEvent.click(editButton);

    const titleInput = screen.getByRole("textbox", { name: "Transcription title" });
    expect(titleInput.className).toContain("motion-safe:duration-200");
  });

  it("uses adaptive title width when editing", () => {
    const task = createTask();

    render(<CompletedView task={task} />);

    const titleBlock = screen.getByTestId("title-block");
    expect(titleBlock.className).toContain("flex-1");

    fireEvent.click(screen.getByRole("button", { name: "Edit transcription title" }));

    const editor = screen.getByTestId("title-editor");
    expect(editor.className).toContain("items-start");
    expect(editor.className).toContain("max-w-none");

    const titleInput = screen.getByRole("textbox", { name: "Transcription title" });
    fireEvent.change(titleInput, { target: { value: "Sync notes" } });
    expect(titleInput).toHaveValue("Sync notes");
  });
});
