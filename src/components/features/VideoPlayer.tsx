/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion, react-hooks/exhaustive-deps */

import * as React from "react";
import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import type WaveSurfer from "wavesurfer.js";
import type RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThemeColors, cacheWaveformPeaks, getCachedWaveformPeaks, formatTime } from "@/lib/utils";
import { WaveformControls } from "@/components/features/WaveformControls";
import {
  DEFAULT_VIDEO_ASPECT_RATIO,
  normalizeVideoAspectRatio,
} from "@/components/features/completed-view-layout";
import { sanitizeSegments } from "@/lib/segment-utils";
import { getAssetUrl, readFileAsBase64 } from "@/services/tauri";
import type { TranscriptionTask, WaveformColorMode } from "@/types";
import { usePlaybackController } from "@/hooks/usePlaybackController";

/**
 * Convert base64 string to Blob
 * Handles both raw base64 strings and data URIs (e.g., data:audio/wav;base64,...)
 */
function base64ToBlob(base64: string, mimeType: string = "audio/wav"): Blob {
  // Strip data URI prefix if present
  let base64Data = base64;
  if (base64.startsWith('data:')) {
    const matches = base64.match(/^data:([^;]+);base64,(.+)$/);
    if (matches && matches[2]) {
      // Use the MIME type from the data URI if available, otherwise use the provided one
      mimeType = matches[1];
      base64Data = matches[2];
    }
  }

  const byteCharacters = atob(base64Data);
  const length = byteCharacters.length;

  // Create Uint8Array directly instead of using intermediate Array
  // This is more memory efficient and avoids the "Invalid array length" error
  const byteArray = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    byteArray[i] = byteCharacters.charCodeAt(i);
  }

  return new Blob([byteArray], { type: mimeType });
}

/**
 * Detect MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split(".").pop();
  const mimeTypes: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    webm: "audio/webm",
    mp4: "video/mp4",
    m4a: "audio/mp4",
    flac: "audio/flac",
    aac: "audio/aac",
  };
  return mimeTypes[ext || ""] || "audio/wav";
}

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
  /** Optional additional class names */
  className?: string;
}

/**
 * Rainbow color palette for segments mode
 */
const RAINBOW_PALETTE = [
  "#ef4444", // red-500
  "#f97316", // orange-500
  "#eab308", // yellow-500
  "#22c55e", // green-500
  "#14b8a6", // teal-500
  "#3b82f6", // blue-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
];

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

/**
 * VideoPlayer component with integrated waveform visualization
 *
 * Features:
 * - HTML5 video player with waveform sync
 * - WaveSurfer.js integration for waveform rendering
 * - Regions plugin for segment/speaker highlighting
 * - LocalStorage caching of waveform peaks (24h TTL)
 * - Color mode switching (segments/speakers)
 * - Theme-aware colors from CSS variables
 */
export const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(function VideoPlayer({
  task,
  colorMode,
  onTimeUpdate,
  isVideoVisible = true,
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
  const [videoAspectRatio, setVideoAspectRatio] = React.useState(DEFAULT_VIDEO_ASPECT_RATIO);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Check if video element should be shown (needed for controller)
  // Show video if: not archived OR archived with keep_all mode (has video file)
  const showVideoElement = React.useMemo(() => {
    if (!task.archived) {
      return !!task.filePath && task.filePath.length > 0;
    }
    // For archived tasks, show video only if keep_all mode (filePath contains archived video)
    return task.archiveMode === "keep_all" && !!task.filePath && task.filePath.length > 0;
  }, [task.filePath, task.archived, task.archiveMode]);

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
    hasVideoElement: showVideoElement,
  });

  // Local state derived from controller for UI rendering
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [volume, setVolume] = React.useState(1);
  const [playbackRate, setPlaybackRate] = React.useState(1);

  // Update local state from controller
  React.useEffect(() => {
    setCurrentTime(controllerCurrentTime);
  }, [controllerCurrentTime]);

  React.useEffect(() => {
    setDuration(controllerDuration);
  }, [controllerDuration]);

  React.useEffect(() => {
    setIsPlaying(controllerIsPlaying);
  }, [controllerIsPlaying]);

  React.useEffect(() => {
    setVolume(controllerVolume);
  }, [controllerVolume]);

  React.useEffect(() => {
    setPlaybackRate(controllerPlaybackRate);
  }, [controllerPlaybackRate]);

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

  // Expose video element via ref
  useImperativeHandle(forwardedRef, () => internalVideoRef.current!);

  // Convert file path to Tauri asset URL for security
  // Use audioPath if task is archived and has audioPath (delete_video mode)
  // Use filePath if task is archived with keep_all mode
  // Otherwise use original file path
  const mediaPath = React.useMemo(() => {
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
  }, [task.filePath, task.audioPath, task.archived, task.archiveMode]);

  const assetUrl = React.useMemo(() => {
    if (!mediaPath) return "";
    const url = getAssetUrl(mediaPath);
    console.log("[VideoPlayer DEBUG] assetUrl generated:", { filePath: mediaPath, url });
    return url;
  }, [mediaPath]);

  useEffect(() => {
    if (!showVideoElement) {
      setVideoAspectRatio(DEFAULT_VIDEO_ASPECT_RATIO);
      return;
    }

    const videoElement = internalVideoRef.current;
    if (!videoElement) return;

    const updateAspectRatio = () => {
      const nextRatio = normalizeVideoAspectRatio(videoElement.videoWidth, videoElement.videoHeight);
      setVideoAspectRatio(nextRatio);
    };

    updateAspectRatio();
    videoElement.addEventListener("loadedmetadata", updateAspectRatio);
    videoElement.addEventListener("resize", updateAspectRatio);

    return () => {
      videoElement.removeEventListener("loadedmetadata", updateAspectRatio);
      videoElement.removeEventListener("resize", updateAspectRatio);
    };
  }, [assetUrl, showVideoElement]);

  /**
   * Generate regions based on color mode and transcription segments
   */
  const generateRegions = useCallback(() => {
    const ws = wavesurferRef.current;
    const regions = regionsRef.current;
    if (!ws || !regions) {
      console.warn("[VideoPlayer DEBUG] Cannot generate regions: WaveSurfer or RegionsPlugin not ready");
      return;
    }

    // Clear any existing regions before adding new ones
    try {
      regions.clearRegions();
    } catch (e) {
      console.warn("[VideoPlayer DEBUG] Failed to clear regions:", e);
    }

    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    const sanitizedSegments = sanitizeSegments(task.result?.segments);
    const sanitizedSpeakerSegments = sanitizeSegments(task.result?.speakerSegments);

    console.log(`[VideoPlayer ${timestamp}] generateRegions called:`, {
      colorMode,
      hasSegments: !!task.result?.segments,
      segmentsCount: task.result?.segments?.length || 0,
      sanitizedSegmentsCount: sanitizedSegments.length,
      hasSpeakerTurns: !!task.result?.speakerTurns,
      speakerTurnsCount: task.result?.speakerTurns?.length || 0,
      hasSpeakerSegments: !!task.result?.speakerSegments,
      speakerSegmentsCount: task.result?.speakerSegments?.length || 0,
      sanitizedSpeakerSegmentsCount: sanitizedSpeakerSegments.length,
    });

    // Clear existing regions
    regions.clearRegions();

    // Determine which segments to use in regular segments mode
    const segmentsToUse = sanitizedSegments;

    console.log("[VideoPlayer] Segments to use:", {
      colorMode,
      usingSpeakerSegments: task.result?.speakerSegments && segmentsToUse === task.result.speakerSegments,
      count: segmentsToUse?.length || 0,
    });

    if (!segmentsToUse) return;

    if (colorMode === "segments") {
      // Use rainbow palette for segments
      segmentsToUse.forEach((segment, index) => {
        try {
          const color = RAINBOW_PALETTE[index % RAINBOW_PALETTE.length];
          regions.addRegion({
            start: segment.start,
            end: segment.end,
            color: withOpacity(color, 25),
            drag: false,
            resize: false,
          });
          const allRegions = regions.getRegions();
          const latestRegion = allRegions[allRegions.length - 1];
          if (latestRegion?.element) {
            latestRegion.element.style.pointerEvents = "none";
          }
        } catch (e) {
          console.error("[VideoPlayer] Error adding segment region:", e);
        }
      });
    } else if (colorMode === "speakers") {
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

      console.log("[VideoPlayer] Speaker region source:", {
        usingSpeakerTurns: mergedSpeakerTurns.length > 0,
        turnsCount: speakerTurns.length,
        mergedTurnsCount: mergedSpeakerTurns.length,
        fallbackCount: fallbackSpeakerSegments.length,
        finalCount: speakerRegions.length,
      });

      if (speakerRegions.length === 0) {
        console.log("[VideoPlayer] No speaker regions to render");
        return;
      }

      // Group by speaker with consistent colors
      // Sort speakers to ensure consistent ordering
      const speakers = Array.from(
        new Set(speakerRegions.map((s) => s.speaker))
      ).sort();

      console.log("[VideoPlayer] Speakers found:", speakers);

      const themeColors = getThemeColors();

      // Create a Map for consistent speaker-to-color mapping
      const speakerColorMap = new Map<string, string>();
      speakers.forEach((speaker, index) => {
        const color = themeColors.chartColors[index % themeColors.chartColors.length];
        speakerColorMap.set(speaker, color);
      });

      console.log("[VideoPlayer] Speaker color map:", Object.fromEntries(speakerColorMap));

      let regionCount = 0;
      const addedRegions: any[] = [];
      speakerRegions.forEach((segment, index) => {
        const color = speakerColorMap.get(segment.speaker) || themeColors.chartColors[0];

        const regionColor = withOpacity(color, 60);

        console.log(`[VideoPlayer] Adding region ${index}:`, {
          start: segment.start,
          end: segment.end,
          speaker: segment.speaker,
          color: regionColor,
        });

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
          addedRegions.push(region);
          regionCount++;
        } catch (e) {
          console.error("[VideoPlayer] Error adding speaker region:", e);
        }
      });

      console.log("[VideoPlayer] Total regions created:", regionCount);
      console.log("[VideoPlayer] Regions in plugin:", regions.getRegions().length);
      console.log("[VideoPlayer] Added region objects:", addedRegions);

    }

    // Check if regions are rendered in Shadow DOM (WaveSurfer v7)
    setTimeout(() => {
      const host = containerRef.current;
      const shadowRoot = host?.shadowRoot;
      const shadowRegions = shadowRoot?.querySelectorAll('[part~="region"]').length ?? 0;
      const legacyRegions = document.querySelectorAll("wave rect").length;

      console.log("[VideoPlayer] Region render check:", {
        pluginRegions: regions.getRegions().length,
        shadowRegions,
        legacyRegions,
        hasShadowRoot: !!shadowRoot,
      });
    }, 100);
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
      console.log("[VideoPlayer DEBUG] useEffect early return:", {
        hasContainer: !!containerRef.current,
        hasMediaPath: !!mediaPath
      });
      return;
    }

    let ws: WaveSurfer | null = null;
    let isUnmounted = false;

    const video = internalVideoRef.current;
    const container = containerRef.current;

    console.log("[VideoPlayer DEBUG] Initializing WaveSurfer:", {
      assetUrl,
      mediaPath,
      filePath: task.filePath,
      audioPath: task.audioPath,
      hasVideo: !!video
    });

    // Cleanup previous instance
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
    }
    isWaveformReadyRef.current = false;
    setIsWaveformReady(false);

    // Check for cached peaks - use mediaPath for archived tasks
    const peaksPath = task.archived && task.audioPath ? task.audioPath : task.filePath;
    const cachedPeaks = getCachedWaveformPeaks(peaksPath ?? "");
    console.log("[VideoPlayer DEBUG] Cached peaks:", !!cachedPeaks, "peaksPath:", peaksPath);

    const themeColors = getThemeColors();

    // Initialize WaveSurfer options (without url - we'll use loadBlob)
    // Optimized for performance: reduced bar size, minPxPerSec limits detail level
    const wsOptions: any = {
      container,
      height: 120,
      normalize: true,
      waveColor: themeColors.waveColor,
      progressColor: themeColors.progressColor,
      cursorColor: themeColors.progressColor,
      barWidth: 1,        // Reduced from 2 - fewer DOM elements
      barGap: 1,
      barRadius: 2,
      minPxPerSec: 0.5,   // Limit detail level for performance
      backend: 'WebAudio', // Use WebAudio for better performance
      dragToSeek: { debounceTime: 0 },
      // Mute WaveSurfer when a <video> element exists: WaveSurfer is used only for
      // waveform visualization; audio comes exclusively from the <video> element.
      // Without this, both play simultaneously causing duplicate audio.
      muted: !!video,
    };

    // Use cached peaks if available
    if (cachedPeaks) {
      wsOptions.peaks = cachedPeaks;
    }

    console.log("[VideoPlayer DEBUG] WaveSurfer options:", {
      ...wsOptions,
      container: "DOM element"
    });

    // Initialize WaveSurfer
    const initWaveSurfer = async () => {
      try {
        const [{ default: WaveSurferLib }, { default: RegionsPluginLib }] = await Promise.all([
          import("wavesurfer.js"),
          import("wavesurfer.js/dist/plugins/regions.js"),
        ]);

        if (isUnmounted) return;

        ws = WaveSurferLib.create(wsOptions);
        wavesurferRef.current = ws;
        console.log("[VideoPlayer DEBUG] WaveSurfer created successfully");

        // Belt-and-suspenders: if a <video> element exists, WaveSurfer is only used
        // for waveform visualization. Mute it via API to guarantee no audio output,
        // regardless of whether the `muted` creation option was honoured.
        if (video) {
          ws.setVolume(0);
        }

        // Register regions plugin after WaveSurfer is created (v7 API)
        const regions = ws.registerPlugin(RegionsPluginLib.create());
        regionsRef.current = regions as RegionsPlugin;
        console.log("[VideoPlayer DEBUG] Regions plugin registered");

        if (cachedPeaks) {
          setIsGenerating(false);
        } else {
          setIsGenerating(true);
        }

        // Load audio via base64 - WaveSurfer handles decoding internally
        console.log("[VideoPlayer DEBUG] Loading audio from:", mediaPath);
        
        readFileAsBase64(mediaPath)
          .then((result) => {
            if (!ws) return;
            if (result.success && result.data) {
              console.log("[VideoPlayer DEBUG] Base64 loaded, length:", result.data.length);
              const mimeType = getMimeType(mediaPath);
              const blob = base64ToBlob(result.data, mimeType);
              console.log("[VideoPlayer DEBUG] Blob created:", blob.size, "bytes, type:", blob.type);
              ws.loadBlob(blob);
            } else {
              console.error("[VideoPlayer DEBUG] Failed to load base64:", result.error);
              setIsGenerating(false);
            }
          })
          .catch((error) => {
            console.error("[VideoPlayer DEBUG] Error loading blob:", error);
            setIsGenerating(false);
          });

        // Event: Waveform ready
        ws.on("ready", () => {
          if (!ws) return;
          console.log("[VideoPlayer DEBUG] WaveSurfer ready event fired");
          isWaveformReadyRef.current = true;
          setIsWaveformReady(true);
          setIsGenerating(false);

          // Cache peaks for next load (only if not already cached)
          if (!cachedPeaks) {
            // Use requestIdleCallback to defer peak calculation for better performance
            const calculatePeaks = () => {
              try {
                const wsAny = ws as any;
                const waveformContainer = container.querySelector("wave");
                if (waveformContainer) {
                  // Get waveform width for peak calculation
                  const waveformWidth = waveformContainer.clientWidth || 1000;

                  // For WebAudio backend, we can access peaks via getDecodedData
                  if (wsAny.getDecodedData) {
                    const decodedData = wsAny.getDecodedData();
                    if (decodedData) {
                      // Calculate peaks from decoded audio data in chunks to avoid blocking
                      const channelData = decodedData.getChannelData(0);
                      const samplesPerPixel = Math.floor(channelData.length / waveformWidth);
                      const peaks: number[] = [];

                      // Process in batches to avoid blocking main thread
                      const batchSize = 1000;
                      let processed = 0;

                      const processBatch = () => {
                        const end = Math.min(processed + batchSize, waveformWidth);
                        for (let i = processed; i < end; i++) {
                          let max = 0;
                          for (let j = 0; j < samplesPerPixel; j++) {
                            const sample = Math.abs(channelData[i * samplesPerPixel + j] || 0);
                            if (sample > max) max = sample;
                          }
                          peaks.push(max);
                        }
                        processed = end;

                        if (processed < waveformWidth) {
                          // Continue processing in next frame
                          requestAnimationFrame(processBatch);
                        } else {
                          // All peaks calculated, cache them using peaksPath
                          if (peaksPath) {
                            cacheWaveformPeaks(peaksPath, new Float32Array(peaks));
                          }
                        }
                      };

                      processBatch();
                    }
                  }
                }
              } catch (e) {
                console.warn("Failed to cache waveform peaks:", e);
              }
            };

            // Use requestIdleCallback if available, otherwise use setTimeout
            if (typeof requestIdleCallback !== 'undefined') {
              requestIdleCallback(calculatePeaks);
            } else {
              setTimeout(calculatePeaks, 0);
            }
          }

          // Generate regions - ensure WaveSurfer is fully ready
          // Use setTimeout to ensure RegionsPlugin is fully initialized
          setTimeout(() => {
            generateRegions();
          }, 50);

          // Set duration for audio-only tasks (when no video element)
          const videoEl = internalVideoRef.current;
          if (!videoEl && ws) {
            const wsDuration = ws.getDuration();
            if (Number.isFinite(wsDuration) && wsDuration > 0) {
              setDuration(wsDuration);
            }
          }

          // Sync waveform cursor with current video position once waveform is ready
          // Only on initial load - this won't cause loops since it's not in a recurring event
          if (videoEl && ws) {
            const duration = videoEl.duration;
            if (Number.isFinite(duration) && duration > 0) {
              const ratio = videoEl.currentTime / duration;
              if (Number.isFinite(ratio)) {
                ws.seekTo(ratio);
              }
            }
          }
        });

        // Event: Waveform error
        ws.on("error", (error: Error) => {
          console.error("[VideoPlayer DEBUG] WaveSurfer error event:", error);
          setIsGenerating(false);
        });

        // Event: Loading
        ws.on("loading", (percent: number) => {
          console.log("[VideoPlayer DEBUG] WaveSurfer loading:", percent + "%");
        });

        // REMOVED: syncSeekPosition function - no longer needed
        // REMOVED: ws.on("seeking", ...) - this caused bidirectional loop!
        // The "seeking" event fires on ALL seeks (including programmatic ws.seekTo), 
        // which created: video timeupdate -> ws.seekTo -> ws.seeking -> video.currentTime -> loop
        
        const handleWaveformUserSeek = (ratio: number) => {
          const dur = ws?.getDuration?.() ?? 0;
          if (dur <= 0) return;

          const clampedRatio = Math.max(0, Math.min(1, ratio));
          const nextTime = clampedRatio * dur;

          controllerSeekTo(nextTime, "waveform");
          setCurrentTime(nextTime);
          onTimeUpdate?.(nextTime);
        };

        // User seeks via waveform interactions
        ws.on("interaction", handleWaveformUserSeek);
        ws.on("drag", handleWaveformUserSeek);

        // Event: Time update from WaveSurfer (for audio-only tasks)
        ws.on("timeupdate", (time: number) => {
          // Only use WS time for audio-only tasks
          if (!showVideoElement) {
            setCurrentTime(time);
            onTimeUpdate?.(time);
          }
        });
      } catch (error) {
        console.error("[VideoPlayer DEBUG] Failed to create WaveSurfer:", error);
        setIsGenerating(false);
      }
    };

    initWaveSurfer();

    // FIX #4: Safe waveform cursor sync - use flag to prevent loops
    // The issue was using ws.on("seeking") which fires on ALL seeks (including programmatic)
    // Instead, we sync only from timeupdate (playback progress) with a flag to detect self-seeks
    const isSelfSeekRef = { current: false };

    // Event: Video time update - update UI state and sync waveform cursor
    // Only sync waveform during playback (not during seek) to prevent loops
    const handleTimeUpdate = () => {
      const videoEl = internalVideoRef.current;
      if (!videoEl) return;

      const videoDuration = videoEl.duration;
      const hasDuration = Number.isFinite(videoDuration) && videoDuration > 0;
      if (hasDuration) {
        setDuration(videoDuration);
      }

      setCurrentTime(videoEl.currentTime);
      onTimeUpdate?.(videoEl.currentTime);
      
      // Safe sync: only update waveform cursor during normal playback, not during seeks
      // Use isSelfSeekRef flag to detect programmatic seeks
      if (!isSelfSeekRef.current && ws && hasDuration) {
        const ratio = videoEl.currentTime / videoDuration;
        if (Number.isFinite(ratio)) {
          ws.seekTo(ratio);
        }
      }
    };

    // Also handle seeked events - they fire after user seeks
    // Mark as self-seek to prevent waveform sync during the seek
    const handleSeekStart = () => {
      isSelfSeekRef.current = true;
    };
    
    const handleSeeked = () => {
      // Reset the flag after a short delay to allow the seek to complete
      setTimeout(() => {
        isSelfSeekRef.current = false;
      }, 50);
      handleTimeUpdate();
    };

    if (video) {
      video.addEventListener("timeupdate", handleTimeUpdate);
      video.addEventListener("seeked", handleSeeked);
      video.addEventListener("seeking", handleSeekStart);
    }

    // Cleanup
    return () => {
      isUnmounted = true;
      isWaveformReadyRef.current = false;
      if (video) {
        video.removeEventListener("timeupdate", handleTimeUpdate);
        video.removeEventListener("seeked", handleSeeked);
        video.removeEventListener("seeking", handleSeekStart);
      }
      ws?.destroy();
    };
  }, [generateRegions, onTimeUpdate, mediaPath, shouldInitializeWaveform, showVideoElement, controllerSeekTo]);

  useEffect(() => {
    const videoEl = internalVideoRef.current;
    if (!videoEl) return;

    const handleDurationUpdate = () => {
      const nextDuration = videoEl.duration;
      if (!Number.isFinite(nextDuration) || nextDuration <= 0) return;

      setDuration(nextDuration);
    };

    videoEl.addEventListener("loadedmetadata", handleDurationUpdate);
    videoEl.addEventListener("durationchange", handleDurationUpdate);
    handleDurationUpdate();

    return () => {
      videoEl.removeEventListener("loadedmetadata", handleDurationUpdate);
      videoEl.removeEventListener("durationchange", handleDurationUpdate);
    };
  }, [assetUrl, showVideoElement]);

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
      console.log("[VideoPlayer] useEffect triggered: colorMode=", colorMode, "isWaveformReady=", isWaveformReady);
      // Add small delay to ensure RegionsPlugin is fully initialized
      setTimeout(() => {
        generateRegions();
      }, 50);
    }
  }, [colorMode, task.result, isWaveformReady, generateRegions]);

  // Sync playback state with video element or WaveSurfer (for audio-only)
  useEffect(() => {
    const ws = wavesurferRef.current;
    const videoElement = internalVideoRef.current;

    // For audio-only tasks, use WaveSurfer events
    // Note: Controller handles play/pause state, these listeners just update local state
    if (!videoElement && ws) {
      const handlePlay = () => {
        setIsPlaying(true);
      };
      const handlePause = () => {
        setIsPlaying(false);
      };

      ws.on("play", handlePlay);
      ws.on("pause", handlePause);

      // Set initial state from WaveSurfer
      setIsPlaying(ws.isPlaying());

      return () => {
        ws.un("play", handlePlay);
        ws.un("pause", handlePause);
      };
    }

    if (!videoElement) return;

    // For video tasks - controller handles state, we just sync local state
    const handlePlay = () => {
      setIsPlaying(true);
    };
    const handlePause = () => {
      setIsPlaying(false);
    };

    videoElement.addEventListener("play", handlePlay);
    videoElement.addEventListener("pause", handlePause);

    // Set initial state from video element
    setIsPlaying(!videoElement.paused);

    return () => {
      videoElement.removeEventListener("play", handlePlay);
      videoElement.removeEventListener("pause", handlePause);
    };
  }, []);

  // Apply volume and playback rate to video element
  useEffect(() => {
    const videoElement = internalVideoRef.current;
    if (!videoElement) return;

    videoElement.volume = volume;
  }, [volume]);

  useEffect(() => {
    const videoElement = internalVideoRef.current;
    if (!videoElement) return;

    videoElement.playbackRate = playbackRate;
  }, [playbackRate]);

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

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Video Player - render only when explicitly visible */}
      {showVideoElement && isVideoVisible && (
        <div
          className={cn(
            "relative mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-border/60 bg-black/95 shadow-sm transition-all duration-300",
            "animate-in fade-in slide-in-from-top-2"
          )}
          style={{
            aspectRatio: videoAspectRatio,
            minHeight: "clamp(128px, 22vh, 240px)",
            maxHeight: "min(46vh, 540px)",
          }}
        >
          <video
            ref={internalVideoRef}
            src={assetUrl}
            controls={isVideoVisible}
            className="h-full w-full object-contain"
          />
        </div>
      )}

      {/* Audio-only message when video is deleted */}
      {!showVideoElement && mediaPath && (
        <div className="rounded-xl border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          Video file removed. Showing audio waveform only.
        </div>
      )}

      {/* Waveform Container */}
      <div className="relative h-[120px] overflow-hidden rounded-lg border bg-card">
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
      <WaveformControls
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        playbackRate={playbackRate}
        onTogglePlayPause={handleTogglePlayPause}
        onVolumeChange={handleVolumeChange}
        onPlaybackRateChange={handlePlaybackRateChange}
      />
    </div>
  );
});
