import { create } from 'zustand';

export type MiniPlayerPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface PlaybackState {
  // Какая задача сейчас играет
  playingTaskId: string | null;
  playingTaskFileName: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;

  // Позиция mini-player на экране
  miniPlayerPosition: MiniPlayerPosition;

  // Single Source of Truth for which VideoPlayer is currently active on screen
  activeForegroundPlayerId: string | null;
  foregroundPlayerCounts: Record<string, number>;

  // Actions
  setPlaying: (taskId: string | null, fileName: string | null, isPlaying: boolean) => void;
  updateTime: (time: number) => void;
  setDuration: (duration: number) => void;
  togglePlayPause: () => void;
  stop: () => void;
  setPosition: (position: MiniPlayerPosition) => void;
  registerForegroundPlayer: (taskId: string) => void;
  unregisterForegroundPlayer: (taskId: string) => void;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  playingTaskId: null,
  playingTaskFileName: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  miniPlayerPosition: 'bottom-left',
  activeForegroundPlayerId: null,
  foregroundPlayerCounts: {},

  setPlaying: (taskId, fileName, isPlaying) => {
    const state = get();
    // Only update if something actually changed
    if (state.playingTaskId === taskId && state.isPlaying === isPlaying) {
      return; // No change needed
    }
    
    // Сбрасываем время только при СМЕНЕ задачи, а не при play/pause
    const isTaskChanged = state.playingTaskId !== taskId;
    
    set({
      playingTaskId: taskId,
      playingTaskFileName: fileName,
      isPlaying,
      // При смене задачи сбрасываем время, иначе сохраняем текущую позицию
      currentTime: isTaskChanged ? 0 : state.currentTime
    });
  },

  updateTime: (time) => set({ currentTime: time }),

  setDuration: (duration) => set({ duration }),

  togglePlayPause: () => {
    const { isPlaying, playingTaskId } = get();
    if (!playingTaskId) return;
    set({ isPlaying: !isPlaying });
  },

  stop: () => {
    set({
      playingTaskId: null,
      playingTaskFileName: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0
    });
  },

  setPosition: (position) => set({ miniPlayerPosition: position }),

  registerForegroundPlayer: (taskId) => {
    const state = get();
    const count = (state.foregroundPlayerCounts[taskId] || 0) + 1;
    set({
      foregroundPlayerCounts: { ...state.foregroundPlayerCounts, [taskId]: count },
      activeForegroundPlayerId: taskId,
    });
  },

  unregisterForegroundPlayer: (taskId) => {
    const state = get();
    const count = Math.max((state.foregroundPlayerCounts[taskId] || 0) - 1, 0);
    const newCounts = { ...state.foregroundPlayerCounts, [taskId]: count };
    
    // When active foreground player unmounts, hand off to another foreground player if available.
    // If no foreground players remain for the playing task, pause playback but keep progress/time.
    if (count === 0 && state.activeForegroundPlayerId === taskId) {
      const fallbackActivePlayerId = Object.entries(newCounts).find(([, playerCount]) => playerCount > 0)?.[0] ?? null;
      const shouldPausePlayback =
        fallbackActivePlayerId === null && state.playingTaskId === taskId;

      set({
        foregroundPlayerCounts: newCounts,
        activeForegroundPlayerId: fallbackActivePlayerId,
        isPlaying: shouldPausePlayback ? false : state.isPlaying,
      });
    } else {
      set({ foregroundPlayerCounts: newCounts });
    }
  },
}));
