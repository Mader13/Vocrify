import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptionOptions } from "@/types";

const { loadModelRustMock, transcribeRustMock } = vi.hoisted(() => ({
  loadModelRustMock: vi.fn(async () => ({ success: true })),
  transcribeRustMock: vi.fn(async () => ({
    success: true,
    data: { segments: [], language: "en", duration: 0 },
  })),
}));

vi.mock("@/services/tauri", () => ({
  loadModelRust: loadModelRustMock,
  transcribeRust: transcribeRustMock,
  initTranscriptionManager: vi.fn(async () => ({ success: true })),
  onTranscriptionComplete: vi.fn(async () => vi.fn()),
}));

import { transcribeWithFallback } from "@/services/transcription";

const baseOptions: TranscriptionOptions = {
  model: "whisper-base",
  device: "cpu",
  language: "en",
  enableDiarization: false,
  diarizationProvider: "none",
  numSpeakers: -1,
};

describe("transcription model lifecycle", () => {
  beforeEach(() => {
    loadModelRustMock.mockClear();
    transcribeRustMock.mockClear();
  });

  it("loads rust model once for consecutive tasks with same model", async () => {
    await transcribeWithFallback("task-1", "C:/tmp/a.wav", baseOptions, "auto");
    await transcribeWithFallback("task-2", "C:/tmp/b.wav", baseOptions, "auto");

    expect(loadModelRustMock).toHaveBeenCalledTimes(1);
    expect(transcribeRustMock).toHaveBeenCalledTimes(2);
  });
});
