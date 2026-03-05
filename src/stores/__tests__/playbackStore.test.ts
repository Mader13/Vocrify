import { beforeEach, describe, expect, it } from "vitest";

import { usePlaybackStore } from "@/stores/playbackStore";

function resetPlaybackStore() {
  usePlaybackStore.setState({
    playingTaskId: null,
    playingTaskFileName: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    miniPlayerPosition: "bottom-left",
    activeForegroundPlayerId: null,
    foregroundPlayerCounts: {},
  });
}

describe("playbackStore foreground handoff", () => {
  beforeEach(() => {
    resetPlaybackStore();
  });

  it("pauses playback but keeps progress when the foreground player unmounts", () => {
    const store = usePlaybackStore.getState();

    store.setPlaying("task-1", "Episode.mp3", true);
    store.updateTime(42);
    store.registerForegroundPlayer("task-1");
    store.unregisterForegroundPlayer("task-1");

    const state = usePlaybackStore.getState();
    expect(state.playingTaskId).toBe("task-1");
    expect(state.currentTime).toBe(42);
    expect(state.isPlaying).toBe(false);
    expect(state.activeForegroundPlayerId).toBeNull();
  });

  it("restores the previous foreground player as fallback", () => {
    const store = usePlaybackStore.getState();

    store.registerForegroundPlayer("task-1");
    store.registerForegroundPlayer("task-2");

    store.unregisterForegroundPlayer("task-2");

    expect(usePlaybackStore.getState().activeForegroundPlayerId).toBe("task-1");
  });
});
