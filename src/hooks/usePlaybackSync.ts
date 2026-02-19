import { useEffect, useCallback } from 'react';
import { usePlaybackStore } from '@/stores/playbackStore';

interface UsePlaybackSyncOptions {
  taskId: string;
  fileName: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  wavesurferRef: React.RefObject<unknown>;
  isWaveformReady: boolean;
}

/**
 * Hook for synchronizing VideoPlayer state with playbackStore.
 * Handles:
 * - Publishing play/pause state to store
 * - Subscribing to store for external control
 * - Syncing currentTime on mount
 */
export function usePlaybackSync({
  taskId,
  fileName,
  videoRef,
  wavesurferRef,
  isWaveformReady,
}: UsePlaybackSyncOptions) {
  const store = usePlaybackStore();

  // Track if we're the active player (the one shown on screen)
  const isActivePlayer = store.playingTaskId === taskId;

  // Subscribe to store for play/pause (when another task started playing)
  useEffect(() => {
    if (!isActivePlayer) {
      // We're not the active player - apply store state to our player
      const videoEl = videoRef.current;
      const ws = wavesurferRef.current as { play?: () => void; pause?: () => void } | null;

      if (!videoEl && !ws) return;

      if (store.isPlaying) {
        videoEl?.play().catch(() => {});
        ws?.play?.();
      } else {
        videoEl?.pause();
        ws?.pause?.();
      }
    }
  }, [store.isPlaying, store.playingTaskId, isActivePlayer, videoRef, wavesurferRef]);

  // Publish our play state to store when user interacts
  const handlePlay = useCallback(() => {
    store.setPlaying(taskId, fileName, true);
  }, [taskId, fileName, store]);

  const handlePause = useCallback(() => {
    // Only update store if we're the active player
    if (store.playingTaskId === taskId) {
      store.setPlaying(taskId, fileName, false);
    }
  }, [taskId, fileName, store, store.playingTaskId]);

  // Sync current time to store
  const handleTimeUpdate = useCallback((time: number) => {
    if (store.playingTaskId === taskId) {
      store.updateTime(time);
    }
  }, [taskId, store]);

  // Sync duration to store when ready
  const handleDurationChange = useCallback((duration: number) => {
    if (store.playingTaskId === taskId) {
      store.setDuration(duration);
    }
  }, [taskId, store]);

  // Restore position on mount if we were playing
  useEffect(() => {
    if (isActivePlayer && (store.currentTime > 0 || store.isPlaying)) {
      const videoEl = videoRef.current;
      const ws = wavesurferRef.current as { getDuration?: () => number; seekTo?: (ratio: number) => void; play?: () => void } | null;

      if (store.currentTime > 0) {
        if (videoEl) {
          videoEl.currentTime = store.currentTime;
        }
        if (ws?.getDuration && ws.seekTo) {
          const duration = ws.getDuration();
          if (duration > 0) {
            ws.seekTo(store.currentTime / duration);
          }
        }
      }

      if (store.isPlaying) {
        videoEl?.play().catch(() => {});
        ws?.play?.();
      }
    }
  }, [isWaveformReady]); // Run once when waveform is ready

  return {
    handlePlay,
    handlePause,
    handleTimeUpdate,
    handleDurationChange,
    isActivePlayer,
  };
}
