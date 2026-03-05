import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ArchiveButton } from "@/components/features/ArchiveButton";
import type { TranscriptionTask } from "@/types";

function createTask(overrides: Partial<TranscriptionTask>): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "sample.wav",
    filePath: "C:/tmp/sample.wav",
    fileSize: 100,
    status: "completed",
    progress: 100,
    options: {
      model: "whisper-base",
      device: "cpu",
      language: "auto",
      enableDiarization: false,
      diarizationProvider: "none",
      numSpeakers: -1,
    },
    result: {
      segments: [],
      language: "en",
      duration: 0,
    },
    error: null,
    archived: false,
    createdAt: new Date("2026-02-20T10:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

describe("ArchiveButton", () => {
  it("is not rendered for cancelled task", () => {
    render(<ArchiveButton task={createTask({ status: "cancelled" })} iconOnly />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
