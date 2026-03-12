import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDropZone } from "@/hooks/useDropZone";
import type { ViewType } from "@/stores";

type DropPayload =
  | { type: "enter" | "over" | "leave" }
  | { type: "drop"; paths: string[] };

type DragDropEvent = {
  payload: DropPayload;
};

type DragDropHandler = (event: DragDropEvent) => void;
type HookProps = {
  currentView: ViewType;
};

const { getFilesMetadataMock } = vi.hoisted(() => ({
  getFilesMetadataMock: vi.fn(),
}));

const activeHandlers = new Set<DragDropHandler>();
const pendingRegistrations: Array<() => void> = [];
const onDragDropEventMock = vi.fn((handler: DragDropHandler) => {
  return new Promise<() => void>((resolve) => {
    pendingRegistrations.push(() => {
      activeHandlers.add(handler);
      resolve(() => {
        activeHandlers.delete(handler);
      });
    });
  });
});

const mockUIState = {
  isDragging: false,
  setDragging: vi.fn(),
};

const mockValidateModelSelection = vi.fn(() => true);

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: onDragDropEventMock,
  }),
}));

vi.mock("@/services/tauri", () => ({
  getFilesMetadata: getFilesMetadataMock,
}));

vi.mock("@/stores", () => ({
  useUIStore: <T,>(selector: (state: typeof mockUIState) => T) => selector(mockUIState),
}));

vi.mock("@/hooks/useModelValidation", () => ({
  useModelValidation: () => ({
    validateModelSelection: mockValidateModelSelection,
  }),
}));

describe("useDropZone", () => {
  beforeEach(() => {
    activeHandlers.clear();
    pendingRegistrations.length = 0;
    onDragDropEventMock.mockClear();
    mockUIState.isDragging = false;
    mockUIState.setDragging.mockClear();
    mockValidateModelSelection.mockClear();
    mockValidateModelSelection.mockReturnValue(true);
    getFilesMetadataMock.mockReset();
    getFilesMetadataMock.mockResolvedValue({
      success: true,
      data: [
        {
          path: "C:\\media\\sample.mp4",
          name: "sample.mp4",
          size: 4096,
          exists: true,
        },
      ],
    });
  });

  it("does not keep stale native drop listeners after re-render during async registration", async () => {
    const onFilesDropped = vi.fn();

    const { rerender } = renderHook(
      ({ currentView }: HookProps) => useDropZone({ currentView, onFilesDropped }),
      {
        initialProps: { currentView: "transcription" },
      },
    );

    rerender({ currentView: "settings" });
    rerender({ currentView: "transcription" });

    expect(onDragDropEventMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingRegistrations.shift()?.();
      pendingRegistrations.shift()?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(activeHandlers.size).toBe(1);
    });

    act(() => {
      for (const handler of activeHandlers) {
        handler({
          payload: {
            type: "drop",
            paths: ["C:\\media\\sample.mp4"],
          },
        });
      }
    });

    await waitFor(() => {
      expect(getFilesMetadataMock).toHaveBeenCalledWith(["C:\\media\\sample.mp4"]);
      expect(onFilesDropped).toHaveBeenCalledTimes(1);
      expect(onFilesDropped).toHaveBeenCalledWith([
        {
          path: "C:\\media\\sample.mp4",
          name: "sample.mp4",
          size: 4096,
        },
      ]);
    });
  });
});
