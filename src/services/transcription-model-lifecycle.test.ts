import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TranscriptionOptions } from "@/types";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@/services/tauri", () => ({
  startTranscription: vi.fn(async () => ({ success: true })),
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
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "transcribe_rust") {
        return { segments: [], language: "en", duration: 0 };
      }

      return undefined;
    });
  });

  it("loads rust model once for consecutive tasks with same model", async () => {
    await transcribeWithFallback("task-1", "C:/tmp/a.wav", baseOptions, "auto");
    await transcribeWithFallback("task-2", "C:/tmp/b.wav", baseOptions, "auto");

    const loadCalls = invokeMock.mock.calls.filter(([command]) => command === "load_model_rust");
    expect(loadCalls).toHaveLength(1);
  });
});
