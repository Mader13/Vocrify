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

  // Actions
  setPlaying: (taskId: string | null, fileName: string | null, isPlaying: boolean) => void;
  updateTime: (time: number) => void;
  setDuration: (duration: number) => void;
  togglePlayPause: () => void;
  stop: () => void;
  setPosition: (position: MiniPlayerPosition) => void;
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  playingTaskId: null,
  playingTaskFileName: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  miniPlayerPosition: 'bottom-left',

  setPlaying: (taskId, fileName, isPlaying) => {
    set({
      playingTaskId: taskId,
      playingTaskFileName: fileName,
      isPlaying,
      // При смене задачи сбрасываем время
      currentTime: 0
    });
  },

  updateTime: (time) => set({ currentTime: time }),

  setDuration: (duration) => set({ duration }),

  togglePlayPause: () => {
    const { isPlaying, playingTaskId } = get();
    if (!playingTaskId) return;
    set({ isPlaying: !isPlaying });
  },

  stop: () => set({
    playingTaskId: null,
    playingTaskFileName: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0
  }),

  setPosition: (position) => set({ miniPlayerPosition: position }),
}));
