/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */

import * as React from "react";
import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import type WaveSurfer from "wavesurfer.js";
import type RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import { Loader2, Play, Pause, Maximize, Volume2, VolumeX, FastForward } from "lucide-react";
import { cn, isVideoFile } from "@/lib/utils";
import { getThemeColors, cacheWaveformPeaks, getCachedWaveformPeaks, formatTime } from "@/lib/utils";
import { WaveformControls } from "@/components/features/WaveformControls";
import {
  VIDEO_OVERLAY_COMPACT_WIDTH,
  VIDEO_OVERLAY_MICRO_WIDTH,
} from "@/components/features/completed-view-layout";
import { sanitizeSegments } from "@/lib/segment-utils";
import { getAssetUrl } from "@/services/tauri";
import type { TranscriptionTask, WaveformColorMode } from "@/types";
import { usePlaybackController } from "@/hooks/usePlaybackController";
import { usePlaybackStore } from "@/stores/playbackStore";


/**
 * Props for the VideoPlayer component
 */
interface VideoPlayerProps {
  /** The transcription task containing the video file and transcription result */
  task: TranscriptionTask;
  /** Current color mode for waveform regions */
  colorMode: WaveformColorMode;
  /** Callback for current playback time updates */
  onTimeUpdate?: (time: number) => void;
  /** Whether video player is visible */
  isVideoVisible?: boolean;
  /** Whether to show waveform controls */
  showControls?: boolean;
  /** Optional additional class names */
  className?: string;
}

/**
 * Build a region color with opacity that works for hex/oklch/rgb values.
 * WaveSurfer accepts any valid CSS color, so color-mix keeps format compatibility.
 */
function withOpacity(color: string, opacityPercent: number): string {
  const clamped = Math.max(0, Math.min(100, opacityPercent));
  return `color-mix(in srgb, ${color} ${clamped}%, transparent)`;
}

type SpeakerRegion = {
  start: number;
  end: number;
  speaker: string;
};

type PlayerControlsMode = "regular" | "compact" | "micro";

/**
 * Merge adjacent regions of the same speaker if the gap is tiny.
 * This reduces visual flicker and produces smoother speaker bands.
 */
function mergeNearbySpeakerRegions(
  regions: SpeakerRegion[],
  maxGapSec: number = 0.12,
): SpeakerRegion[] {
  if (regions.length <= 1) return regions;

  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const merged: SpeakerRegion[] = [];

  for (const region of sorted) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ ...region });
      continue;
    }

    const gap = region.start - prev.end;
    if (prev.speaker === region.speaker && gap >= 0 && gap <= maxGapSec) {
      prev.end = Math.max(prev.end, region.end);
    } else {
      merged.push({ ...region });
    }
  }

  return merged;
}

export interface VideoPlayerHandle {
  seekTo: (time: number) => void;
}

/**
 * VideoPlayer component with integrated waveform visualization
 *
 * Features:
 * - HTML5 video player with waveform sync
 * - WaveSurfer.js integration for waveform rendering
 * - Regions plugin for speaker highlighting
 * - LocalStorage caching of waveform peaks (24h TTL)
 * - Color mode switching (clean/speakers)
 * - Theme-aware colors from CSS variables
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer({
  task,
  colorMode,
  onTimeUpdate,
  isVideoVisible = true,
  showControls = true,
  className,
}, forwardedRef) {
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const isWaveformReadyRef = useRef(false);
  const [isWaveformReady, setIsWaveformReady] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [isWaveformHovered, setIsWaveformHovered] = React.useState(false);
  const [hoverPreviewTime, setHoverPreviewTime] = React.useState<number | null>(null);
  const [waveformWidth, setWaveformWidth] = React.useState(0);
  const [overlayWidth, setOverlayWidth] = React.useState(0);
  const [isVideoHovered, setIsVideoHovered] = React.useState(false);
  const [canHover, setCanHover] = React.useState(true);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const lastReportedTimeRef = useRef(-1);

  const toggleFullscreen = useCallback(() => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Check if video element should be shown (needed for controller)
  // Show video if: not archived OR archived with keep_all mode (has video file)
  const showVideoElement = React.useMemo(() => {
    if (task.managedCopyPath) {
      return isVideoFile(task.managedCopyPath);
    }

    if (!task.archived) {
      return !!task.filePath && task.filePath.length > 0;
    }
    // For archived tasks, show video only if keep_all mode (filePath contains archived video)
    return task.archiveMode === "keep_all" && !!task.filePath && task.filePath.length > 0;
  }, [task.managedCopyPath, task.filePath, task.archived, task.archiveMode]);
  // Playback controller - Single Source of Truth for playback
  // Replaces usePlaybackSync to prevent bidirectional seek loops
  const {
    currentTime: controllerCurrentTime,
    duration: controllerDuration,
    isPlaying: controllerIsPlaying,
    volume: controllerVolume,
    playbackRate: controllerPlaybackRate,
    togglePlayPause: controllerTogglePlayPause,
    setVolume: controllerSetVolume,
    setPlaybackRate: controllerSetPlaybackRate,
    seekTo: controllerSeekTo,
  } = usePlaybackController({
    taskId: task.id,
    fileName: task.fileName,
    videoRef: internalVideoRef,
    wavesurferRef: wavesurferRef,
    isWaveformReady,
    // Pass showVideoElement (not hasVisibleVideoElement) so the controller keeps
    // the video as authoritative source even when it's hidden in transcript-focus mode.
    hasVideoElement: showVideoElement,
  });

  const PLAYBACK_RATES = React.useMemo(() => [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2], []);
  const cyclePlaybackRate = useCallback(() => {
    const currentIndex = PLAYBACK_RATES.indexOf(controllerPlaybackRate);
    const nextIndex = (currentIndex + 1) % PLAYBACK_RATES.length;
    controllerSetPlaybackRate(PLAYBACK_RATES[nextIndex]);
  }, [PLAYBACK_RATES, controllerPlaybackRate, controllerSetPlaybackRate]);

  const currentTime = controllerCurrentTime;
  const duration = controllerDuration;

  useEffect(() => {
    if (!onTimeUpdate) return;
    if (Math.abs(currentTime - lastReportedTimeRef.current) < 0.2) return;
    lastReportedTimeRef.current = currentTime;
    onTimeUpdate(currentTime);
  }, [currentTime, onTimeUpdate]);

  // Sync foreground player status - always register when component is mounted (user is on this task's page)
  const registerForegroundPlayer = usePlaybackStore((s) => s.registerForegroundPlayer);
  const unregisterForegroundPlayer = usePlaybackStore((s) => s.unregisterForegroundPlayer);
  
  React.useEffect(() => {
    // Register as foreground player when user is on this task's page
    registerForegroundPlayer(task.id);
    return () => {
      unregisterForegroundPlayer(task.id);
    };
  }, [task.id, registerForegroundPlayer, unregisterForegroundPlayer]);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(media.matches);
    update();

    if (media.addEventListener) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  // Lazy initialization flag - only load waveform when component is visible
  const [shouldInitializeWaveform, setShouldInitializeWaveform] = React.useState(false);
  const shouldInitializeWaveformRef = useRef(shouldInitializeWaveform);
  useEffect(() => {
    shouldInitializeWaveformRef.current = shouldInitializeWaveform;
  }, [shouldInitializeWaveform]);

  // Safe requestIdleCallback fallback for environments where it's not available
  const safeRequestIdleCallback = (callback: () => void): number => {
    if (typeof requestIdleCallback !== 'undefined') {
      return requestIdleCallback(callback);
    }
    // Fallback to setTimeout for environments without requestIdleCallback
    return window.setTimeout(callback, 100);
  };

  const safeCancelIdleCallback = (id: number): void => {
    if (typeof cancelIdleCallback !== 'undefined') {
      cancelIdleCallback(id);
    } else {
      window.clearTimeout(id);
    }
  };

  // Use Intersection Observer to defer waveform loading until visible
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let idleCallbackId: number | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || shouldInitializeWaveformRef.current || idleCallbackId !== null) {
          return;
        }

        idleCallbackId = safeRequestIdleCallback(() => {
          shouldInitializeWaveformRef.current = true;
          setShouldInitializeWaveform(true);
          idleCallbackId = null;
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(container);
    return () => {
      observer.disconnect();
      if (idleCallbackId !== null) {
        safeCancelIdleCallback(idleCallbackId);
      }
    };
  }, []);

  // Expose video element and custom methods via ref
  useImperativeHandle(forwardedRef, () => ({
    seekTo: (time: number) => {
      controllerSeekTo(time, "store");
    },
  }), [controllerSeekTo]);

  useEffect(() => {
    return () => {
      const videoElement = internalVideoRef.current;
      if (videoElement) {
        try {
          videoElement.pause();
        } catch {
          // noop
        }

        videoElement.removeAttribute("src");

        try {
          videoElement.load();
        } catch {
          // noop
        }
      }

      const ws = wavesurferRef.current;
      if (ws) {
        try {
          ws.pause();
        } catch {
          // noop
        }

        try {
          ws.destroy();
        } catch {
          // noop
        }

        wavesurferRef.current = null;
      }

      regionsRef.current = null;
      isWaveformReadyRef.current = false;
    };
  }, []);

  // Convert file path to Tauri asset URL for security
  // Use audioPath if task is archived and has audioPath (delete_video mode)
  // Use filePath if task is archived with keep_all mode
  // Otherwise use original file path
  const mediaPath = React.useMemo(() => {
    if (task.managedCopyPath) {
      return task.managedCopyPath;
    }

    // If task is archived with keep_all mode, use archived filePath
    if (task.archived && task.archiveMode === "keep_all" && task.filePath) {
      return task.filePath;
    }
    // If task is archived with delete_video mode, use audioPath
    if (task.archived && task.audioPath) {
      return task.audioPath;
    }
    // Otherwise use the original file path
    return task.filePath || "";
  }, [task.managedCopyPath, task.filePath, task.audioPath, task.archived, task.archiveMode]);

  const assetUrl = React.useMemo(() => {
    if (!mediaPath) return "";
    return getAssetUrl(mediaPath);
  }, [mediaPath]);

  useEffect(() => {
    if (!showVideoElement) {
      return;
    }

    const videoElement = internalVideoRef.current;
    if (!videoElement) return;
    videoElement.muted = false;
  }, [assetUrl, showVideoElement]);

  /**
   * Generate regions based on color mode and speaker diarization data
   */
  const generateRegions = useCallback(() => {
    const ws = wavesurferRef.current;
    const regions = regionsRef.current;
    if (!ws || !regions) {
      return;
    }

    // Clear any existing regions before adding new ones
    try {
      regions.clearRegions();
    } catch {
      // noop
    }

    const sanitizedSegments = sanitizeSegments(task.result?.segments);
    const sanitizedSpeakerSegments = sanitizeSegments(task.result?.speakerSegments);

    if (colorMode === "clean") {
      return;
    }

    if (colorMode === "speakers") {
      // Prefer raw diarization speaker turns for waveform regions.
      // They represent only speech intervals and do not paint silence gaps.
      const speakerTurns = (task.result?.speakerTurns || [])
        .filter((turn) => turn.end > turn.start && !!turn.speaker?.trim())
        .map((turn) => ({
          start: turn.start,
          end: turn.end,
          speaker: turn.speaker,
        }));

      const mergedSpeakerTurns = mergeNearbySpeakerRegions(speakerTurns, 0.12);

      // Fallback for older results: derive regions from speaker-labeled segments,
      // but ignore unlabeled segments (speaker=null) to avoid painting silence.
      const fallbackSpeakerSegments = (
        sanitizedSpeakerSegments.length > 0
          ? sanitizedSpeakerSegments
          : sanitizedSegments
      )
        .filter((segment) => {
          const hasSpeaker = !!segment.speaker?.trim();
          const validRange = segment.end > segment.start;
          return hasSpeaker && validRange;
        })
        .map((segment) => ({
          start: segment.start,
          end: segment.end,
          speaker: segment.speaker as string,
        }));

      const speakerRegions = mergedSpeakerTurns.length > 0 ? mergedSpeakerTurns : fallbackSpeakerSegments;

      if (speakerRegions.length === 0) {
        return;
      }

      // Group by speaker with consistent colors
      // Sort speakers to ensure consistent ordering
      const speakers = Array.from(
        new Set(speakerRegions.map((s) => s.speaker))
      ).sort();

      const themeColors = getThemeColors();

      // Create a Map for consistent speaker-to-color mapping
      const speakerColorMap = new Map<string, string>();
      speakers.forEach((speaker, index) => {
        const color = themeColors.chartColors[index % themeColors.chartColors.length];
        speakerColorMap.set(speaker, color);
      });
      speakerRegions.forEach((segment) => {
        const color = speakerColorMap.get(segment.speaker) || themeColors.chartColors[0];

        const regionColor = withOpacity(color, 60);

        try {
          const region = regions.addRegion({
            start: segment.start,
            end: segment.end,
            color: regionColor,
            drag: false,
            resize: false,
          });
          if (region.element) {
            region.element.style.pointerEvents = "none";
          }
        } catch (e) {
          console.error("[VideoPlayer] Error adding speaker region:", e);
        }
      });
    }
  }, [task.result, colorMode]);

  /**
   * Initialize WaveSurfer.js (only when component is visible)
   */
  useEffect(() => {
    // Defer initialization until component is visible
    if (!shouldInitializeWaveform) {
      return;
    }

    // Use mediaPath which handles both filePath and audioPath for archived tasks
    if (!containerRef.current || !mediaPath) {
      return;
    }

    let ws: WaveSurfer | null = null;
    let isUnmounted = false;

    const video = internalVideoRef.current;
    const container = containerRef.current;

    // Cleanup previous instance
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
    }
    isWaveformReadyRef.current = false;
    setIsWaveformReady(false);

    // Check for cached peaks - use mediaPath for archived tasks
    const peaksPath = task.archived && task.audioPath ? task.audioPath : task.filePath;
    const cachedPeaks = getCachedWaveformPeaks(peaksPath ?? "");

    const themeColors = getThemeColors();

    // Initialize WaveSurfer options
    // Peaks are provided directly by backend, so WaveSurfer only draws - no audio decoding needed.
    const wsOptions: any = {
      container,
      height: 60,
      normalize: true,
      waveColor: themeColors.waveColor,
      progressColor: themeColors.progressColor,
      cursorColor: themeColors.progressColor,
      barWidth: 1,
      barGap: 1,
      barRadius: 2,
      minPxPerSec: 0.5,
      // Use MediaElement backend if <video> exists to stream without RAM loading.
      backend: video ? 'MediaElement' : 'WebAudio',
      media: video || undefined,
      dragToSeek: { debounceTime: 0 },
    };

    // Initialize WaveSurfer
    const initWaveSurfer = async () => {
      try {
        const [{ default: WaveSurferLib }, { default: RegionsPluginLib }] = await Promise.all([
          import("wavesurfer.js"),
          import("wavesurfer.js/dist/plugins/regions.js"),
        ]);

        if (isUnmounted) return;

        let initialPeaks = cachedPeaks;
        const peaksPath = task.archived && task.audioPath ? task.audioPath : task.filePath;

        // Fetch peaks if not cached and prevent UI freeze
        if (!initialPeaks && mediaPath) {
          setIsGenerating(true);
          const { generateWaveformPeaks } = await import("@/services/tauri");
          const result = await generateWaveformPeaks(mediaPath, 1000); 
          if (result.success && result.data) {
            initialPeaks = new Float32Array(result.data);
            if (peaksPath) {
              cacheWaveformPeaks(peaksPath, initialPeaks);
            }
          } else {
            console.error("[VideoPlayer DEBUG] Failed to generate peaks via backend:", result.error);
          }
        }

        if (initialPeaks) {
          wsOptions.peaks = [initialPeaks];
        }

        // Set URL if there is no linked video element
        if (!video) {
          wsOptions.url = assetUrl;
        }

        ws = WaveSurferLib.create(wsOptions);
        wavesurferRef.current = ws;

        // Register regions plugin after WaveSurfer is created (v7 API)
        const regions = ws.registerPlugin(RegionsPluginLib.create());
        regionsRef.current = regions as RegionsPlugin;


        // Event: Waveform ready
        ws.on("ready", () => {
          if (!ws) return;
          isWaveformReadyRef.current = true;
          setIsWaveformReady(true);
          setIsGenerating(false);

          // Generate regions - ensure WaveSurfer is fully ready
          // Use setTimeout to ensure RegionsPlugin is fully initialized
          setTimeout(() => {
            generateRegions();
          }, 50);
        });

        // Event: Waveform error
        ws.on("error", (error: Error) => {
          console.error("[VideoPlayer DEBUG] WaveSurfer error event:", error);
          setIsGenerating(false);
        });

        // REMOVED: syncSeekPosition function - no longer needed
        // REMOVED: ws.on("seeking", ...) - this caused bidirectional loop!
        // The "seeking" event fires on ALL seeks (including programmatic ws.seekTo), 
        // which created: video timeupdate -> ws.seekTo -> ws.seeking -> video.currentTime -> loop
        
        // `interaction` fires with time in seconds (relativeX * getDuration)
        const handleWaveformInteraction = (newTime: number) => {
          const dur = ws?.getDuration?.() ?? 0;
          if (dur <= 0) return;

          const clampedTime = Math.max(0, Math.min(dur, newTime));

          controllerSeekTo(clampedTime, "waveform");
        };

        // `drag` fires with relativeX ratio (0-1), distinct from `interaction`
        const handleWaveformDrag = (relativeX: number) => {
          const dur = ws?.getDuration?.() ?? 0;
          if (dur <= 0) return;

          const clampedTime = Math.max(0, Math.min(dur, relativeX * dur));

          controllerSeekTo(clampedTime, "waveform");
        };

        // User seeks via waveform interactions
        ws.on("interaction", handleWaveformInteraction);
        ws.on("drag", handleWaveformDrag);

      } catch (error) {
        console.error("[VideoPlayer DEBUG] Failed to create WaveSurfer:", error);
        setIsGenerating(false);
      }
    };

    initWaveSurfer();

    // Cleanup
    return () => {
      isUnmounted = true;
      isWaveformReadyRef.current = false;
      ws?.destroy();
    };
  }, [generateRegions, mediaPath, shouldInitializeWaveform, showVideoElement, controllerSeekTo]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateWidth = () => {
      const width = node.getBoundingClientRect().width;
      setWaveformWidth(width);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [mediaPath]);

  useEffect(() => {
    const node = overlayRef.current;
    if (!node) return;

    const updateWidth = () => {
      const width = node.getBoundingClientRect().width;
      setOverlayWidth(width);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Regenerate regions when color mode or result changes
  useEffect(() => {
    if (isWaveformReady) {
      // Add small delay to ensure RegionsPlugin is fully initialized
      setTimeout(() => {
        generateRegions();
      }, 50);
    }
  }, [colorMode, task.result, isWaveformReady, generateRegions]);

  // Playback control handlers - use controller for authoritative actions
  const handleTogglePlayPause = useCallback(() => {
    controllerTogglePlayPause();
  }, [controllerTogglePlayPause]);

  const handleVolumeChange = useCallback((newVolume: number) => {
    controllerSetVolume(newVolume);
  }, [controllerSetVolume]);

  const handlePlaybackRateChange = useCallback((newRate: number) => {
    controllerSetPlaybackRate(newRate);
  }, [controllerSetPlaybackRate]);

  const cursorRatio = duration > 0 ? Math.min(Math.max(currentTime / duration, 0), 1) : 0;
  const cursorPosition = waveformWidth * cursorRatio;
  const edgePadding = 16;
  const overlayHalf = overlayWidth / 2;
  const minCenter = edgePadding + overlayHalf;
  const maxCenter = waveformWidth - edgePadding - overlayHalf;
  const hasCenterSpace = minCenter <= maxCenter;
  const constrainedCenter = waveformWidth > 0
    ? hasCenterSpace
      ? Math.min(Math.max(cursorPosition, minCenter), maxCenter)
      : waveformWidth / 2
    : edgePadding;
  const timeOverlayStyle = {
    left: `${constrainedCenter}px`,
    transform: "translateX(-50%)",
    pointerEvents: "none",
  } satisfies React.CSSProperties;
  const displayedTime = isWaveformHovered ? (hoverPreviewTime ?? currentTime) : currentTime;
  const controlsMode: PlayerControlsMode = React.useMemo(() => {
    if (waveformWidth <= 0) {
      return "regular";
    }

    if (waveformWidth <= VIDEO_OVERLAY_MICRO_WIDTH) {
      return "micro";
    }

    if (waveformWidth <= VIDEO_OVERLAY_COMPACT_WIDTH) {
      return "compact";
    }

    return "regular";
  }, [waveformWidth]);
  const isCompactControls = controlsMode !== "regular";
  const isMicroControls = controlsMode === "micro";
  const canDeferSecondaryControls = showControls;
  const showOverlaySpeed = !canDeferSecondaryControls || !isMicroControls;
  const showOverlayVolumeSlider = !canDeferSecondaryControls || controlsMode === "regular";
  const showOverlayDuration = !isMicroControls;
  const shouldAutoHideOverlay = canHover && !isCompactControls;
  const isOverlayVisible = !shouldAutoHideOverlay || isVideoHovered;
  const overlayTimeLabel = showOverlayDuration
    ? `${formatTime(currentTime)} / ${formatTime(duration)}`
    : formatTime(currentTime);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Video Player - always in DOM when task has video so playback is not interrupted.
          Hidden via CSS when in transcript-focus mode; the <video> element keeps playing. */}
      {showVideoElement && (
        <div
          ref={videoContainerRef}
          className={cn(
            "relative mx-auto w-full flex-1 min-h-[160px] overflow-hidden rounded-2xl border border-border/60 bg-black/95 shadow-sm transition-all duration-300",
            "animate-in fade-in slide-in-from-top-2 group/video flex items-center justify-center",
            !isVideoVisible && "hidden"
          )}
          style={{
            maxHeight: "clamp(220px, 46vh, 520px)",
          }}
          onMouseEnter={() => setIsVideoHovered(true)}
          onMouseLeave={() => setIsVideoHovered(false)}
        >
          <video
            ref={internalVideoRef}
            src={assetUrl}
            controls={false}
            className="h-full w-full object-contain cursor-pointer"
            onClick={controllerTogglePlayPause}
          />
          
          {/* Custom Floating Control Overlay */}
          <div 
            className={cn(
              "absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none px-2 sm:px-4",
              "transition-all duration-300 ease-out z-10",
              isOverlayVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            )}
          >
            <div 
              className={cn(
                "pointer-events-auto flex items-center max-w-full overflow-hidden",
                "rounded-full border border-white/20 bg-black/65 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] text-white",
                isCompactControls ? "gap-1.5 px-2 py-1.5" : "gap-3 px-4 py-2.5"
              )}
            >
              {/* Play/Pause Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  controllerTogglePlayPause();
                }}
                className={cn(
                  "group/btn relative flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-all hover:bg-primary/90 active:scale-95",
                  isMicroControls ? "h-8 w-8" : "h-10 w-10",
                )}
                title={controllerIsPlaying ? "Pause" : "Play"}
              >
                {controllerIsPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4 ml-0.5 fill-current" />
                )}
              </button>
              
              {/* Time Label */}
              <div className="flex shrink-0 items-center px-1">
                <span className={cn(
                  "font-mono font-medium tracking-tight text-white/90 tabular-nums whitespace-nowrap",
                  isMicroControls ? "text-[12px]" : "text-[14px]",
                )}>
                  {overlayTimeLabel}
                </span>
              </div>

              {/* Speed Button (hidden in micro mode) */}
              {showOverlaySpeed && (
                <div className="flex shrink-0 items-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      cyclePlaybackRate();
                    }}
                    className={cn(
                      "flex items-center justify-center gap-1 rounded-full bg-white/10 text-xs font-bold text-white/90 transition-all hover:bg-white/20 hover:text-white active:scale-95",
                      isCompactControls ? "h-8 px-2" : "h-10 px-3",
                    )}
                    title={`Playback Speed: ${controllerPlaybackRate}x`}
                  >
                    <FastForward className="h-4 w-4" />
                    <span className={cn("text-center", isCompactControls ? "w-6" : "w-8")}>
                      {controllerPlaybackRate}x
                    </span>
                  </button>
                </div>
              )}

              {/* Volume Control */}
              <div className="flex shrink items-center min-w-0">
                <div
                  className={cn(
                    "group/volume flex items-center rounded-full bg-white/5 transition-all duration-300",
                    isMicroControls ? "h-8" : "h-10"
                  )}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      controllerSetVolume(controllerVolume === 0 ? 1 : 0);
                    }}
                    className={cn(
                      "flex shrink-0 items-center justify-center rounded-full text-white/80 transition-all hover:text-white active:scale-95",
                      isMicroControls ? "h-8 w-8" : "h-10 w-10",
                    )}
                    title={controllerVolume === 0 ? "Unmute" : "Mute"}
                  >
                    {controllerVolume === 0 ? (
                      <VolumeX className="h-4 w-4" />
                    ) : (
                      <Volume2 className="h-4 w-4" />
                    )}
                  </button>

                  {/* Volume Slider - expands on hover */}
                  {showOverlayVolumeSlider && (
                    <div className="flex h-full items-center overflow-hidden transition-all duration-300 w-0 opacity-0 group-hover/volume:w-20 group-hover/volume:opacity-100 group-hover/volume:px-1.5">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={controllerVolume}
                        onChange={(e) => {
                          e.stopPropagation();
                          controllerSetVolume(parseFloat(e.target.value));
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onWheel={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const delta = -Math.sign(e.deltaY) * 0.05;
                          const newVolume = Math.max(0, Math.min(1, controllerVolume + delta));
                          controllerSetVolume(newVolume);
                        }}
                        className="h-1.5 w-full min-w-[60px] cursor-pointer appearance-none rounded-full bg-white/20 outline-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform hover:[&::-webkit-slider-thumb]:scale-125"
                        style={{
                          background: `linear-gradient(to right, white ${controllerVolume * 100}%, rgba(255,255,255,0.2) ${controllerVolume * 100}%)`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Fullscreen Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullscreen();
                }}
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-full bg-white/5 text-white/80 transition-all hover:bg-white/20 hover:text-white active:scale-95",
                  isMicroControls ? "h-8 w-8" : "h-10 w-10",
                )}
                title="Toggle Fullscreen"
              >
                <Maximize className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waveform Container */}
      <div className="relative h-15 shrink-0 overflow-hidden rounded-lg border bg-card">
        {/* Waveform */}
        <div
          ref={containerRef}
          className="h-full w-full"
          onMouseEnter={() => {
            setIsWaveformHovered(true);
            setHoverPreviewTime(null);
          }}
          onMouseLeave={() => {
            setIsWaveformHovered(false);
            setHoverPreviewTime(null);
          }}
          onMouseMove={(e) => {
            if (duration > 0 && containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const ratio = Math.max(0, Math.min(1, x / rect.width));
              setHoverPreviewTime(ratio * duration);
            }
          }}
        />

        {/* Time Overlay */}
        <div
          ref={overlayRef}
          style={timeOverlayStyle}
          className={cn(
            "absolute top-2 px-2 py-1 rounded-md bg-black/70 text-white text-xs font-mono transition-all duration-200 z-10 whitespace-nowrap leading-tight",
            isWaveformHovered ? "bg-black/90 scale-105" : "bg-black/70"
          )}
        >
          {isWaveformHovered ? (
            <>
              {formatTime(displayedTime)} / {formatTime(duration)}
            </>
          ) : (
            formatTime(displayedTime)
          )}
        </div>

        {/* Generating Spinner */}
        {isGenerating && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Generating waveform...</p>
            </div>
          </div>
        )}
      </div>

      {/* Waveform Controls */}
      {showControls && (
        <div className="shrink-0">
          <WaveformControls
            isPlaying={controllerIsPlaying}
            currentTime={currentTime}
            duration={duration}
            volume={controllerVolume}
            playbackRate={controllerPlaybackRate}
            density={controlsMode}
            onTogglePlayPause={handleTogglePlayPause}
            onVolumeChange={handleVolumeChange}
            onPlaybackRateChange={handlePlaybackRateChange}
          />
        </div>
      )}
    </div>
  );
});

