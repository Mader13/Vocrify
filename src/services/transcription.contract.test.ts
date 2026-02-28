import { afterEach, describe, expect, it, vi } from "vitest";

import type { TranscriptionResult } from "@/types";

let tauriCompletionHandler:
  | ((taskId: string, result: TranscriptionResult) => void)
  | null = null;

vi.mock("@/services/tauri", () => ({
  startTranscription: vi.fn(),
  onTranscriptionComplete: vi.fn(async (callback: (taskId: string, result: TranscriptionResult) => void) => {
    tauriCompletionHandler = callback;
    return vi.fn();
  }),
}));

import { subscribeToTranscriptionCompletion } from "@/services/transcription";

function createResult(): TranscriptionResult {
  return {
    segments: [
      {
        start: 0,
        end: 1,
        text: "hello",
        speaker: null,
        confidence: 0.9,
      },
    ],
    language: "en",
    duration: 1,
  };
}

afterEach(() => {
  tauriCompletionHandler = null;
  vi.clearAllMocks();
});

describe("transcription completion contract", () => {
  it("updates task status when backend completion event arrives", async () => {
    const updateTaskStatus = vi.fn();
    const unsubscribe = await subscribeToTranscriptionCompletion(updateTaskStatus);
    const result = createResult();

    expect(tauriCompletionHandler).toBeTypeOf("function");
    tauriCompletionHandler?.("backend-task", result);

    expect(updateTaskStatus).toHaveBeenCalledWith("backend-task", "completed", result);
    unsubscribe();
  });

  it("updates task status when Rust completion event is dispatched", async () => {
    const updateTaskStatus = vi.fn();
    const unsubscribe = await subscribeToTranscriptionCompletion(updateTaskStatus);
    const result = createResult();

    window.dispatchEvent(
      new CustomEvent("transcription-complete", {
        detail: {
          taskId: "rust-task",
          result,
        },
      }),
    );

    expect(updateTaskStatus).toHaveBeenCalledWith("rust-task", "completed", result);
    unsubscribe();
  });
});
