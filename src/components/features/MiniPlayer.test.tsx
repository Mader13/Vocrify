import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MiniPlayer } from "@/components/features/MiniPlayer";
import { useUIStore } from "@/stores";
import { usePlaybackStore } from "@/stores/playbackStore";

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

function resetUiStore() {
  useUIStore.setState({
    currentView: "transcription",
    selectedTaskId: null,
  });
}

function seedPlayingTask() {
  usePlaybackStore.setState({
    playingTaskId: "task-1",
    playingTaskFileName: "Episode.mp3",
    isPlaying: true,
    currentTime: 32,
    duration: 120,
  });
}

describe("MiniPlayer", () => {
  beforeEach(() => {
    resetPlaybackStore();
    resetUiStore();
  });

  afterEach(() => {
    resetPlaybackStore();
    resetUiStore();
  });

  it("stays visible on non-transcription tabs even if selected task matches", () => {
    seedPlayingTask();
    useUIStore.setState({
      currentView: "models",
      selectedTaskId: "task-1",
    });

    render(<MiniPlayer />);

    expect(screen.getByText("Episode.mp3")).toBeInTheDocument();
  });

  it("clears playback state on close", () => {
    seedPlayingTask();
    useUIStore.setState({
      currentView: "models",
      selectedTaskId: "another-task",
    });

    render(<MiniPlayer />);

    fireEvent.click(screen.getByTitle("Stop and close"));

    expect(usePlaybackStore.getState().playingTaskId).toBeNull();
    expect(usePlaybackStore.getState().isPlaying).toBe(false);
  });
});
