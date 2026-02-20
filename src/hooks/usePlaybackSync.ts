import { useEffect, useCallback } from 'react';
import { usePlaybackStore } from '@/stores/playbackStore';

interface UsePlaybackSyncOptions {
  taskId: string;
  fileName: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  wavesurferRef: React.RefObject<unknown>;
  isWaveformReady: boolean;
}

function playVideoSafely(videoEl: HTMLVideoElement | null) {
  if (!videoEl || !videoEl.paused) return;

  try {
    const playResult = videoEl.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(console.error);
    }
  } catch (error) {
    console.error(error);
  }
}

function pauseVideoSafely(videoEl: HTMLVideoElement | null) {
  if (!videoEl || videoEl.paused) return;

  try {
    videoEl.pause();
  } catch (error) {
    console.error(error);
  }
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
  // NOTE: We only use this to pause when switching tasks, not to trigger playback
  useEffect(() => {
    const videoEl = videoRef.current;
    const ws = wavesurferRef.current as { play?: () => void; pause?: () => void; isPlaying?: () => boolean } | null;

    if (!videoEl && !ws) return;

    // If we're not the active player, pause
    if (!isActivePlayer) {
      pauseVideoSafely(videoEl);
      ws?.pause?.();
      return;
    }

    // If we ARE the active player but store says we should be paused, pause
    if (!store.isPlaying) {
      pauseVideoSafely(videoEl);
      ws?.pause?.();
    }
    // NOTE: We don't call play() here - let the video's own events handle that
  }, [store.playingTaskId, store.isPlaying, isActivePlayer, videoRef, wavesurferRef, taskId]);

  // Listen for play/pause events from MiniPlayer
  useEffect(() => {
    const handlePlayRequest = (e: Event) => {
      const taskIdFromEvent = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      // Only respond if the event is for our task
      if (taskIdFromEvent !== taskId || !isActivePlayer) return;
      const videoEl = videoRef.current;
      const ws = wavesurferRef.current as { play?: () => void; isPlaying?: () => boolean } | null;

      playVideoSafely(videoEl);

      // Only trigger WaveSurfer play for audio-only tasks (no video element).
      // When a video element exists, WaveSurfer is muted and used solely for
      // visualization — calling ws.play() here would duplicate the audio.
      if (!videoEl) {
        const isWaveformAlreadyPlaying = ws?.isPlaying?.() ?? false;
        if (!isWaveformAlreadyPlaying) {
          ws?.play?.();
        }
      }
    };

    const handlePauseRequest = (e: Event) => {
      const taskIdFromEvent = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      // Only respond if the event is for our task
      if (taskIdFromEvent !== taskId || !isActivePlayer) return;
      const videoEl = videoRef.current;
      const ws = wavesurferRef.current as { pause?: () => void } | null;
      pauseVideoSafely(videoEl);
      ws?.pause?.();
    };

    window.addEventListener('miniplayer-play', handlePlayRequest);
    window.addEventListener('miniplayer-pause', handlePauseRequest);

    return () => {
      window.removeEventListener('miniplayer-play', handlePlayRequest);
      window.removeEventListener('miniplayer-pause', handlePauseRequest);
    };
  }, [isActivePlayer, videoRef, wavesurferRef, taskId]);

  // Publish our play state to store when user interacts
  const handlePlay = useCallback(() => {
    // Only update if not already playing in store
    if (store.isPlaying && store.playingTaskId === taskId) return;
    store.setPlaying(taskId, fileName, true);
  }, [taskId, fileName, store]);

  const handlePause = useCallback(() => {
    // Only update store if we're the active player
    if (store.playingTaskId === taskId) {
      store.setPlaying(taskId, fileName, false);
    }
  }, [taskId, fileName, store]);

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
  // Include taskId to trigger on task switch, and isActivePlayer to ensure we only restore for active task
  useEffect(() => {
    if (!isActivePlayer) return;
    
    const videoEl = videoRef.current;
    const ws = wavesurferRef.current as { getDuration?: () => number; seekTo?: (ratio: number) => number; play?: () => void } | null;

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
      playVideoSafely(videoEl);
      // Only play WaveSurfer for audio-only tasks (no video element).
      if (!videoEl) {
        ws?.play?.();
      }
    }
  }, [isWaveformReady, isActivePlayer, taskId]);

  return {
    handlePlay,
    handlePause,
    handleTimeUpdate,
    handleDurationChange,
    isActivePlayer,
  };
}
