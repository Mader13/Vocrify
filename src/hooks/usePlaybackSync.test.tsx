import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

import { usePlaybackSync } from "@/hooks/usePlaybackSync";
import { usePlaybackStore } from "@/stores/playbackStore";

interface MockWaveSurfer {
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  isPlaying: ReturnType<typeof vi.fn>;
}

interface HarnessProps {
  taskId: string;
  wavesurfer: MockWaveSurfer;
  withVideo?: boolean;
}

function Harness({ taskId, wavesurfer, withVideo = false }: HarnessProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wavesurferRef = useRef<unknown>(wavesurfer);

  usePlaybackSync({
    taskId,
    fileName: "Episode.mp3",
    videoRef,
    wavesurferRef,
    isWaveformReady: true,
  });

  if (!withVideo) {
    return null;
  }

  return <video ref={videoRef} data-testid="sync-video" />;
}

function resetPlaybackStore() {
  usePlaybackStore.setState({
    playingTaskId: null,
    playingTaskFileName: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    miniPlayerPosition: "bottom-left",
  });
}

describe("usePlaybackSync", () => {
  beforeEach(() => {
    resetPlaybackStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores duplicate play requests when waveform audio is already playing", () => {
    const wavesurfer: MockWaveSurfer = {
      play: vi.fn(),
      pause: vi.fn(),
      isPlaying: vi.fn(() => true),
    };

    usePlaybackStore.setState({
      playingTaskId: "task-1",
      playingTaskFileName: "Episode.mp3",
      isPlaying: false,
    });

    render(<Harness taskId="task-1" wavesurfer={wavesurfer} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("miniplayer-play", {
          detail: { taskId: "task-1" },
        })
      );
    });

    expect(wavesurfer.play).not.toHaveBeenCalled();
  });

  it("plays waveform audio when it is currently paused", () => {
    const wavesurfer: MockWaveSurfer = {
      play: vi.fn(),
      pause: vi.fn(),
      isPlaying: vi.fn(() => false),
    };

    usePlaybackStore.setState({
      playingTaskId: "task-1",
      playingTaskFileName: "Episode.mp3",
      isPlaying: false,
    });

    render(<Harness taskId="task-1" wavesurfer={wavesurfer} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("miniplayer-play", {
          detail: { taskId: "task-1" },
        })
      );
    });

    expect(wavesurfer.play).toHaveBeenCalledTimes(1);
  });

  it("uses video playback and keeps waveform muted when video element exists", () => {
    const wavesurfer: MockWaveSurfer = {
      play: vi.fn(),
      pause: vi.fn(),
      isPlaying: vi.fn(() => false),
    };

    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(() => Promise.resolve());

    usePlaybackStore.setState({
      playingTaskId: "task-1",
      playingTaskFileName: "Episode.mp3",
      isPlaying: false,
    });

    render(<Harness taskId="task-1" wavesurfer={wavesurfer} withVideo />);

    const video = screen.getByTestId("sync-video") as HTMLVideoElement;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => true,
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("miniplayer-play", {
          detail: { taskId: "task-1" },
        })
      );
    });

    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(wavesurfer.play).not.toHaveBeenCalled();
  });
});
