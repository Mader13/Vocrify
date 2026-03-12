import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { TranscriptionTask } from "@/types";

const mocks = vi.hoisted(() => ({
  getAssetUrl: vi.fn((path: string) => `asset://${path}`),
  readFileAsArrayBuffer: vi.fn(),
  registerForegroundPlayer: vi.fn(),
  unregisterForegroundPlayer: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  getAssetUrl: mocks.getAssetUrl,
  readFileAsArrayBuffer: mocks.readFileAsArrayBuffer,
}));

vi.mock("@/hooks/usePlaybackController", () => ({
  usePlaybackController: () => ({
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    volume: 1,
    playbackRate: 1,
    togglePlayPause: vi.fn(),
    setVolume: vi.fn(),
    setPlaybackRate: vi.fn(),
    seekTo: vi.fn(),
  }),
}));

vi.mock("@/stores/playbackStore", () => ({
  usePlaybackStore: (selector: (state: {
    registerForegroundPlayer: typeof mocks.registerForegroundPlayer;
    unregisterForegroundPlayer: typeof mocks.unregisterForegroundPlayer;
  }) => unknown) => selector({
    registerForegroundPlayer: mocks.registerForegroundPlayer,
    unregisterForegroundPlayer: mocks.unregisterForegroundPlayer,
  }),
}));

import { VideoPlayer } from "@/components/features/VideoPlayer";

function createTask(overrides: Partial<TranscriptionTask> = {}): TranscriptionTask {
  return {
    id: "task-1",
    fileName: "sample.mp4",
    filePath: "C:/source/sample.mp4",
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
      duration: 0,
    },
    error: null,
    createdAt: new Date("2026-03-12T00:00:00.000Z"),
    startedAt: new Date("2026-03-12T00:00:01.000Z"),
    completedAt: new Date("2026-03-12T00:00:02.000Z"),
    ...overrides,
  };
}

describe("VideoPlayer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows archived no-media state without starting waveform generation", () => {
    render(
      <VideoPlayer
        task={createTask({
          archived: true,
          archiveMode: "text_only",
          managedCopyPath: "C:/managed/sample.mp4",
          managedCopyStatus: "done",
          audioPath: "C:/archive/sample.mp3",
        })}
        colorMode="clean"
      />,
    );

    expect(screen.getByText("Media preview unavailable")).toBeInTheDocument();
    expect(screen.getByText("This archived item no longer has playable audio or video.")).toBeInTheDocument();
    expect(screen.queryByText("Generating waveform...")).not.toBeInTheDocument();
    expect(mocks.getAssetUrl).not.toHaveBeenCalled();
  });

  it("eagerly switches archived audio sources to blob urls", async () => {
    class MockIntersectionObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    class MockResizeObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    const createObjectURL = vi.fn(() => "blob:archive-audio");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("requestIdleCallback", ((cb: () => void) => {
      cb();
      return 1;
    }) as typeof requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    class MockUrl extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }

    vi.stubGlobal("URL", MockUrl);

    mocks.readFileAsArrayBuffer.mockResolvedValue({
      success: true,
      data: new Uint8Array([1, 2, 3]).buffer,
    });

    const { container } = render(
      <VideoPlayer
        task={createTask({
          archived: true,
          archiveMode: "delete_video",
          filePath: undefined,
          audioPath: "C:/AppData/archive/sample.mp3",
        })}
        colorMode="clean"
      />,
    );

    await waitFor(() => {
      expect(mocks.readFileAsArrayBuffer).toHaveBeenCalledWith("C:/AppData/archive/sample.mp3");
      expect(createObjectURL).toHaveBeenCalled();
    });

    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio).toHaveAttribute("src", "blob:archive-audio");
  });

  it("falls back to blob url when archived video asset source fails", async () => {
    class MockIntersectionObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    class MockResizeObserver {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    const createObjectURL = vi.fn(() => "blob:archive-video");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.stubGlobal("requestIdleCallback", ((cb: () => void) => {
      cb();
      return 1;
    }) as typeof requestIdleCallback);
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    class MockUrl extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }

    vi.stubGlobal("URL", MockUrl);

    mocks.readFileAsArrayBuffer.mockResolvedValue({
      success: true,
      data: new Uint8Array([1, 2, 3]).buffer,
    });

    const { container } = render(
      <VideoPlayer
        task={createTask({
          archived: true,
          archiveMode: "keep_all",
          filePath: "C:/AppData/archive/sample.mp4",
        })}
        colorMode="clean"
      />,
    );

    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.error(video as HTMLVideoElement);

    await waitFor(() => {
      expect(mocks.readFileAsArrayBuffer).toHaveBeenCalledWith("C:/AppData/archive/sample.mp4");
      expect(createObjectURL).toHaveBeenCalled();
      expect(video).toHaveAttribute("src", "blob:archive-video");
    });
  });
});
