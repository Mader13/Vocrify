import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useModelValidation } from "@/hooks/useModelValidation";

type MockModel = {
  name: string;
  installed: boolean;
};

const mockStoreState: {
  selectedTranscriptionModel: string | null;
  availableModels: MockModel[];
  pendingModelDeletions: Record<string, { requestedAt: number }>;
} = {
  selectedTranscriptionModel: null,
  availableModels: [],
  pendingModelDeletions: {},
};

vi.mock("@/stores/modelsStore", () => ({
  useModelsStore: () => mockStoreState,
}));

describe("useModelValidation", () => {
  beforeEach(() => {
    mockStoreState.selectedTranscriptionModel = null;
    mockStoreState.availableModels = [];
    mockStoreState.pendingModelDeletions = {};
  });

  it("blocks validation when selected model is pending deletion", () => {
    mockStoreState.selectedTranscriptionModel = "whisper-base";
    mockStoreState.availableModels = [{ name: "whisper-base", installed: true }];
    mockStoreState.pendingModelDeletions = {
      "whisper-base": { requestedAt: Date.now() },
    };

    const { result } = renderHook(() => useModelValidation());

    let isValid = true;
    act(() => {
      isValid = result.current.validateModelSelection();
    });

    expect(isValid).toBe(false);
    expect(result.current.modelError.title).toBe("Model Scheduled For Deletion");
  });

  it("passes validation when selected model is installed and not pending", () => {
    mockStoreState.selectedTranscriptionModel = "whisper-base";
    mockStoreState.availableModels = [{ name: "whisper-base", installed: true }];

    const { result } = renderHook(() => useModelValidation());

    let isValid = false;
    act(() => {
      isValid = result.current.validateModelSelection();
    });

    expect(isValid).toBe(true);
  });
});
