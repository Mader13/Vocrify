import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlaybackStore } from '@/stores/playbackStore';
import { logger } from '@/lib/logger';

export type SeekSource = 'video' | 'waveform' | 'miniplayer' | 'store' | null;

export interface UsePlaybackControllerOptions {
  taskId: string;
  fileName: string;
  /** Video element for video tasks */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** WaveSurfer instance for audio visualization */
  wavesurferRef: React.RefObject<unknown>;
  /** Whether WaveSurfer is fully initialized and ready */
  isWaveformReady: boolean;
  /** Whether this component has a video element (vs audio-only) */
  hasVideoElement: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => void;

interface WaveSurferInstance {
  play?: () => void;
  pause?: () => void;
  isPlaying?: () => boolean;
  getDuration?: () => number;
  seekTo?: (ratio: number) => number | void;
  getCurrentTime?: () => number;
  setVolume?: (volume: number) => void;
  setPlaybackRate?: (rate: number) => void;
  on?: (event: string, handler: AnyFunction) => void;
  un?: (event: string, handler: AnyFunction) => void;
}

/**
 * Single Source of Truth (SSOT) for playback control.
 * 
 * This hook centralizes all playback commands (play, pause, seek, volume, rate)
 * and ensures unidirectional data flow to prevent seek loops between
 * HTMLVideoElement and WaveSurfer.
 * 
 * ARCHITECTURE:
 * - UI actions → Controller → Media Element → Store update → UI render
 * - No direct component-to-component sync (prevents loops)
 * - Seek source tracking to prevent self-generated updates
 * 
 * @param options - Configuration for the playback controller
 * @returns Controller API and state bindings
 */
export function usePlaybackController({
  taskId,
  fileName,
  videoRef,
  wavesurferRef,
  isWaveformReady,
  hasVideoElement,
}: UsePlaybackControllerOptions) {
  // Use individual store selector to track active player state
  const playingTaskId = usePlaybackStore((s) => s.playingTaskId);
  const storeIsPlaying = usePlaybackStore((s) => s.isPlaying);
  
  // Track if we're the active player (the one shown on screen)
  const isActivePlayer = playingTaskId === taskId;
  
  // Local state for immediate UI feedback (before store updates)
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [playbackRate, setPlaybackRateState] = useState(1);
  
  // Refs for values needed in callbacks without dependencies
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const wsRef = useRef<WaveSurferInstance | null>(null);
  const isWaveformReadyRef = useRef(isWaveformReady);
  const hasVideoElementRef = useRef(hasVideoElement);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  
  // Store action refs for stable callback dependencies
  const storeActionsRef = useRef(usePlaybackStore.getState());
  
  // Keep refs in sync - use ref objects themselves as dependencies
  useEffect(() => {
    videoElRef.current = videoRef.current ?? null;
  });
  
  useEffect(() => {
    wsRef.current = wavesurferRef.current as WaveSurferInstance | null;
  });
  
  useEffect(() => {
    isWaveformReadyRef.current = isWaveformReady;
  }, [isWaveformReady]);

  useEffect(() => {
    hasVideoElementRef.current = hasVideoElement;
  }, [hasVideoElement]);

  // Sync refs for time tracking
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  // Keep store actions ref up to date
  useEffect(() => {
    storeActionsRef.current = usePlaybackStore.getState();
  });

  // Ensure local media pauses when this controller loses activity or the store pauses
  useEffect(() => {
    const shouldPause = !isActivePlayer || !storeIsPlaying;
    if (!shouldPause) return;

    setIsPlaying(false);

    const videoEl = videoElRef.current;
    const ws = wsRef.current;
    const hasVideo = hasVideoElementRef.current;

    if (hasVideo && videoEl && !videoEl.paused) {
      videoEl.pause();
      return;
    }

    if (ws?.isPlaying?.()) {
      ws.pause?.();
    }
  }, [isActivePlayer, storeIsPlaying]);

  // ============================================
  // Core Playback Commands
  // ============================================
  
  /**
   * Play - starts playback on the authoritative media element
   * For video tasks: uses HTMLVideoElement
   * For audio-only tasks: uses WaveSurfer
   * 
   * FIX #1: If not active player, capture activity first instead of blocking
   */
  const play = useCallback(async () => {
    const store = storeActionsRef.current;
    const currentPlayingTaskId = store.playingTaskId;
    
    // If not active, capture activity first
    if (currentPlayingTaskId !== taskId) {
      logger.debug('[PlaybackController] Capturing activity for play', { taskId, wasActive: currentPlayingTaskId });
      store.setPlaying(taskId, fileName, true);
    }
    
    const videoEl = videoElRef.current;
    const ws = wsRef.current;
    const hasVideo = hasVideoElementRef.current;
    
    logger.debug('[PlaybackController] Play', { 
      taskId, 
      hasVideo, 
      wsReady: isWaveformReadyRef.current,
      videoPaused: videoEl?.paused 
    });
    
    // Update local state
    setIsPlaying(true);
    
    // Execute on authoritative element
    if (hasVideo && videoEl) {
      // Video element is authoritative for video tasks
      try {
        await videoEl.play();
      } catch (error) {
        logger.error('[PlaybackController] Video play failed', { error: String(error), taskId });
        setIsPlaying(false);
        store.setPlaying(taskId, fileName, false);
      }
    } else if (ws && isWaveformReadyRef.current) {
      // WaveSurfer is authoritative for audio-only tasks
      ws.play?.();
    }
  }, [taskId, fileName]);
  
  /**
   * Pause - pauses playback on the authoritative media element
   * FIX #1: Also capture activity if not active
   */
  const pause = useCallback(() => {
    const store = storeActionsRef.current;
    const currentPlayingTaskId = store.playingTaskId;
    
    // If not active, capture activity first (for seek from other player)
    if (currentPlayingTaskId !== taskId) {
      store.setPlaying(taskId, fileName, false);
      setIsPlaying(false);
      return;
    }
    
    const videoEl = videoElRef.current;
    const ws = wsRef.current;
    const hasVideo = hasVideoElementRef.current;
    
    logger.debug('[PlaybackController] Pause', { taskId, hasVideo });
    
    // Update store first
    store.setPlaying(taskId, fileName, false);
    setIsPlaying(false);
    
    // Execute on authoritative element
    if (hasVideo && videoEl) {
      videoEl.pause();
    } else if (ws) {
      ws.pause?.();
    }
  }, [taskId, fileName]);
  
  /**
   * Toggle play/pause
   */
  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);
  
  /**
   * Seek to specific time
   * @param time - Time in seconds
   * @param source - Source of the seek request (for loop prevention)
   * FIX #1: Also capture activity if not active
   */
  const seekTo = useCallback((time: number, source: SeekSource = 'store') => {
    const store = storeActionsRef.current;
    const currentPlayingTaskId = store.playingTaskId;
    
    // If not active, capture activity first
    if (currentPlayingTaskId !== taskId) {
      store.setPlaying(taskId, fileName, store.isPlaying);
    }
    
    const videoEl = videoElRef.current;
    const ws = wsRef.current;
    const hasVideo = hasVideoElementRef.current;
    const dur = durationRef.current;
    
    // Validate time
    if (!Number.isFinite(time) || time < 0) {
      logger.warn('[PlaybackController] Invalid seek time', { time, taskId });
      return;
    }
    
    const clampedTime = Math.min(time, dur);
    
    logger.debug('[PlaybackController] Seek', { 
      taskId, 
      time: clampedTime, 
      source,
      hasVideo,
      duration: dur 
    });
    
    // Update store
    store.updateTime(clampedTime);
    setCurrentTime(clampedTime);
    
    // Execute seek on authoritative element
    if (hasVideo && videoEl) {
      // For video tasks: video is authoritative
      // Only seek if source is NOT video (prevent loop)
      if (source !== 'video') {
        videoEl.currentTime = clampedTime;
      }
    } else if (ws && isWaveformReadyRef.current) {
      // For audio tasks: WaveSurfer is authoritative
      // Only seek if source is NOT waveform (prevent loop)
      if (source !== 'waveform' && ws.seekTo) {
        const ratio = dur > 0 ? clampedTime / dur : 0;
        ws.seekTo(Math.max(0, Math.min(1, ratio)));
      }
    }
  }, [taskId, fileName]);
  
  /**
   * Set volume
   */
  const setVolume = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    
    const videoEl = videoElRef.current;
    const ws = wsRef.current;
    const hasVideo = hasVideoElementRef.current;
    
    logger.debug('[PlaybackController] Volume', { taskId, volume: clampedVolume, hasVideo });
    
    setVolumeState(clampedVolume);
    
    if (hasVideo && videoEl) {
      videoEl.volume = clampedVolume;
    } else if (ws?.setVolume) {
      ws.setVolume(clampedVolume);
    }
  }, [taskId]);
  
  /**
   * Set playback rate
   */
  const setPlaybackRate = useCallback((rate: number) => {
    const clampedRate = Math.max(0.25, Math.min(4, rate));
    
    const videoEl = videoElRef.current;
    const ws = wsRef.current;
    const hasVideo = hasVideoElementRef.current;
    
    logger.debug('[PlaybackController] PlaybackRate', { taskId, rate: clampedRate, hasVideo });
    
    setPlaybackRateState(clampedRate);
    
    if (hasVideo && videoEl) {
      videoEl.playbackRate = clampedRate;
    } else if (ws?.setPlaybackRate) {
      ws.setPlaybackRate?.(clampedRate);
    }
  }, [taskId]);

  // ============================================
  // Event Subscriptions (authoritative element → store)
  // ============================================
  
  // Subscribe to store changes for external control (MiniPlayer, etc.)
  useEffect(() => {
    if (!isActivePlayer) return;
    
    // Handle play requests from MiniPlayer via window events
    const handlePlayRequest = (e: Event) => {
      const taskIdFromEvent = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (taskIdFromEvent !== taskId) return;
      
      logger.debug('[PlaybackController] Received play request', { taskId });
      play();
    };
    
    const handlePauseRequest = (e: Event) => {
      const taskIdFromEvent = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (taskIdFromEvent !== taskId) return;
      
      logger.debug('[PlaybackController] Received pause request', { taskId });
      pause();
    };
    
    window.addEventListener('miniplayer-play', handlePlayRequest);
    window.addEventListener('miniplayer-pause', handlePauseRequest);
    
    return () => {
      window.removeEventListener('miniplayer-play', handlePlayRequest);
      window.removeEventListener('miniplayer-pause', handlePauseRequest);
    };
  }, [isActivePlayer, taskId, play, pause]);
  
  // Sync with store state on mount (restore position)
  // FIX #3: Also trigger when transitioning from inactive → active
  const restorePlayed = useRef(false);
  useEffect(() => {
    const store = storeActionsRef.current;
    
    // Only restore if we're active and haven't restored yet
    if (!isActivePlayer || restorePlayed.current) return;
    restorePlayed.current = true;
    
    const { currentTime: storeTime, isPlaying: storeIsPlaying, duration: storeDuration } = store;
    
    // Restore position
    if (storeTime > 0) {
      const videoEl = videoElRef.current;
      const ws = wsRef.current;
      const hasVideo = hasVideoElementRef.current;
      
      if (hasVideo && videoEl) {
        videoEl.currentTime = storeTime;
      } else if (ws?.seekTo && isWaveformReadyRef.current) {
        const dur = storeDuration || ws.getDuration?.() || 0;
        if (dur > 0) {
          ws.seekTo(storeTime / dur);
        }
      }
    }
    
    // Restore playing state
    if (storeIsPlaying) {
      play();
    }
  }, [isActivePlayer, play]);
  
  // Subscribe to store duration changes
  useEffect(() => {
    const store = storeActionsRef.current;
    if (!isActivePlayer) return;
    
    if (store.duration > 0) {
      setDuration(store.duration);
      durationRef.current = store.duration;
    }
  }, [isActivePlayer]);

  // ============================================
  // Time Sync (authoritative → UI)
  // ============================================
  
  // For video tasks: subscribe to video element time updates
  useEffect(() => {
    const store = storeActionsRef.current;
    const videoEl = videoElRef.current;
    if (!videoEl || !hasVideoElementRef.current || !isActivePlayer) return;
    
    const handleTimeUpdate = () => {
      const time = videoEl.currentTime;
      const dur = videoEl.duration;
      
      // Update local state for immediate UI feedback
      if (Math.abs(time - currentTimeRef.current) > 0.05) {
        setCurrentTime(time);
      }
      
      // Update duration if available
      if (Number.isFinite(dur) && dur > 0 && dur !== durationRef.current) {
        setDuration(dur);
        store.setDuration(dur);
      }
      
      // Publish to store (with source tracking to prevent loops)
      // We don't pass 'video' as source here to allow sync,
      // but the actual seek operations check source before applying
      if (store.playingTaskId === taskId) {
        store.updateTime(time);
      }
    };
    
    const handlePlay = () => {
      setIsPlaying(true);
      if (store.playingTaskId !== taskId) {
        store.setPlaying(taskId, fileName, true);
      }
    };
    
    const handlePause = () => {
      setIsPlaying(false);
    };
    
    const handleSeeked = () => {
      // After seek completes, sync time
      handleTimeUpdate();
    };
    
    videoEl.addEventListener('timeupdate', handleTimeUpdate);
    videoEl.addEventListener('play', handlePlay);
    videoEl.addEventListener('pause', handlePause);
    videoEl.addEventListener('seeked', handleSeeked);
    
    // Set initial state
    if (videoEl.duration > 0) {
      setDuration(videoEl.duration);
      store.setDuration(videoEl.duration);
    }
    
    return () => {
      videoEl.removeEventListener('timeupdate', handleTimeUpdate);
      videoEl.removeEventListener('play', handlePlay);
      videoEl.removeEventListener('pause', handlePause);
      videoEl.removeEventListener('seeked', handleSeeked);
    };
  }, [isActivePlayer, taskId, fileName]);
  
  // For audio-only tasks: subscribe to WaveSurfer
  useEffect(() => {
    const store = storeActionsRef.current;
    const ws = wsRef.current;
    if (!ws || hasVideoElementRef.current || !isActivePlayer) return;
    
    // Wait for WaveSurfer to be ready
    if (!isWaveformReadyRef.current) return;
    
    const handlePlay = () => {
      setIsPlaying(true);
      if (store.playingTaskId !== taskId) {
        store.setPlaying(taskId, fileName, true);
      }
    };
    
    const handlePause = () => {
      setIsPlaying(false);
    };
    
    const handleTimeUpdate = (time: number) => {
      if (Math.abs(time - currentTimeRef.current) > 0.05) {
        setCurrentTime(time);
      }
      
      if (store.playingTaskId === taskId) {
        store.updateTime(time);
      }
    };
    
    ws.on?.('play', handlePlay);
    ws.on?.('pause', handlePause);
    ws.on?.('timeupdate', handleTimeUpdate);
    
    // Set initial state
    const dur = ws.getDuration?.();
    if (dur && dur > 0) {
      setDuration(dur);
      store.setDuration(dur);
    }
    setIsPlaying(ws.isPlaying?.() ?? false);
    
    return () => {
      ws.un?.('play', handlePlay);
      ws.un?.('pause', handlePause);
      ws.un?.('timeupdate', handleTimeUpdate);
    };
  }, [isActivePlayer, taskId, fileName, isWaveformReady]);

  // ============================================
  // Return Controller API
  // ============================================
  
  return {
    // State (local, for immediate render)
    currentTime,
    duration,
    isPlaying,
    volume,
    playbackRate,
    
    // Actions
    play,
    pause,
    togglePlayPause,
    seekTo,
    setVolume,
    setPlaybackRate,
    
    // Metadata
    isActivePlayer,
  };
}
