import * as React from "react";
import { useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import type WaveSurfer from "wavesurfer.js";
import type RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThemeColors, cacheWaveformPeaks, getCachedWaveformPeaks } from "@/lib/utils";
import { getAssetUrl, readFileAsBase64 } from "@/services/tauri";
import type { TranscriptionTask, TranscriptionSegment, WaveformColorMode } from "@/types";

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
 * Remove malformed "umbrella" segment that covers almost entire file
 * while many normal segments also exist inside it.
 */
function sanitizeSegments(
  segments?: TranscriptionSegment[],
): TranscriptionSegment[] {
  if (!segments || segments.length === 0) return [];

  const valid = segments.filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  if (valid.length <= 1) return valid;

  const epsilon = 0.05;
  const minStart = Math.min(...valid.map((s) => s.start));
  const maxEnd = Math.max(...valid.map((s) => s.end));

  const removeIndexes = new Set<number>();

  valid.forEach((candidate, idx) => {
    const isFullRange = candidate.start <= minStart + epsilon && candidate.end >= maxEnd - epsilon;
    if (!isFullRange) return;

    const nestedCount = valid.filter((s, i) => {
      if (i === idx) return false;
      return s.start >= candidate.start - epsilon && s.end <= candidate.end + epsilon;
    }).length;

    if (nestedCount >= 2) {
      removeIndexes.add(idx);
    }
  });

  if (removeIndexes.size === 0) return valid;
  return valid.filter((_, idx) => !removeIndexes.has(idx));
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

  // Expose video element via ref
  useImperativeHandle(forwardedRef, () => internalVideoRef.current!);

  // Convert file path to Tauri asset URL for security
  const assetUrl = useMemo(() => {
    if (!task.filePath) return "";
    const url = getAssetUrl(task.filePath);
    console.log("[VideoPlayer DEBUG] assetUrl generated:", { filePath: task.filePath, url });
    return url;
  }, [task.filePath]);

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
   * Initialize WaveSurfer.js
   */
  useEffect(() => {
    if (!containerRef.current || !task.filePath) {
      console.log("[VideoPlayer DEBUG] useEffect early return:", {
        hasContainer: !!containerRef.current,
        hasFilePath: !!task.filePath
      });
      return;
    }

    let ws: WaveSurfer | null = null;
    let isUnmounted = false;

    const video = internalVideoRef.current;
    const container = containerRef.current;

    console.log("[VideoPlayer DEBUG] Initializing WaveSurfer:", {
      assetUrl,
      filePath: task.filePath,
      hasVideo: !!video
    });

    // Cleanup previous instance
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
    }
    isWaveformReadyRef.current = false;
    setIsWaveformReady(false);

    // Check for cached peaks
    const cachedPeaks = getCachedWaveformPeaks(task.filePath);
    console.log("[VideoPlayer DEBUG] Cached peaks:", !!cachedPeaks);

    const themeColors = getThemeColors();

    // Initialize WaveSurfer options (without url - we'll use loadBlob)
    const wsOptions: any = {
      container,
      height: 120,
      normalize: true,
      waveColor: themeColors.waveColor,
      progressColor: themeColors.progressColor,
      cursorColor: themeColors.progressColor,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
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

        // Register regions plugin after WaveSurfer is created (v7 API)
        const regions = ws.registerPlugin(RegionsPluginLib.create());
        regionsRef.current = regions as RegionsPlugin;
        console.log("[VideoPlayer DEBUG] Regions plugin registered");

        if (cachedPeaks) {
          setIsGenerating(false);
        } else {
          setIsGenerating(true);
        }

        // Load audio file as Blob (workaround for Tauri asset URL CORS issue)
        console.log("[VideoPlayer DEBUG] Loading audio as Blob...");
        readFileAsBase64(task.filePath)
          .then((result) => {
            if (!ws) return;
            if (result.success && result.data) {
              console.log("[VideoPlayer DEBUG] Base64 loaded, length:", result.data.length);
              const mimeType = getMimeType(task.filePath);
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
            // Try to access peaks from the internal waveform data
            const wsAny = ws as any;
            const waveformContainer = container.querySelector("wave");
            if (waveformContainer) {
              // Get waveform width for peak calculation
              const waveformWidth = waveformContainer.clientWidth || 1000;
              // Peaks are stored in the waveform element's dataset or calculated
              // For WebAudio backend, we can access peaks via getDecodedData
              if (wsAny.getDecodedData) {
                try {
                  const decodedData = wsAny.getDecodedData();
                  if (decodedData) {
                    // Calculate peaks from decoded audio data
                    const channelData = decodedData.getChannelData(0);
                    const peaks: number[] = [];
                    const samplesPerPixel = Math.floor(channelData.length / waveformWidth);
                    for (let i = 0; i < waveformWidth; i++) {
                      let max = 0;
                      for (let j = 0; j < samplesPerPixel; j++) {
                        const sample = Math.abs(channelData[i * samplesPerPixel + j] || 0);
                        if (sample > max) max = sample;
                      }
                      peaks.push(max);
                    }
                    cacheWaveformPeaks(task.filePath, new Float32Array(peaks));
                  }
                } catch (e) {
                  console.warn("Failed to cache waveform peaks:", e);
                }
              }
            }
          }

          // Generate regions - ensure WaveSurfer is fully ready
          // Use setTimeout to ensure RegionsPlugin is fully initialized
          setTimeout(() => {
            generateRegions();
          }, 50);

          // Sync waveform cursor with current video position once waveform is ready
          const videoEl = internalVideoRef.current;
          if (videoEl) {
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

        // Event: Region click - seek video
        if (regionsRef.current) {
          regionsRef.current.on("region-clicked", (region: any) => {
            const videoEl = internalVideoRef.current;
            if (videoEl) {
              videoEl.currentTime = region.start;
              if (videoEl.paused) {
                videoEl.play();
              }
            }
          });
        }

        // Event: Waveform click - seek video
        ws.on("interaction", (position: number) => {
          const videoEl = internalVideoRef.current;
          if (videoEl) {
            videoEl.currentTime = position;
          }
        });
      } catch (error) {
        console.error("[VideoPlayer DEBUG] Failed to create WaveSurfer:", error);
        setIsGenerating(false);
      }
    };

    initWaveSurfer();

    // Event: Video time update - sync waveform
    const handleTimeUpdate = () => {
      const videoEl = internalVideoRef.current;
      if (!videoEl || !ws || !isWaveformReadyRef.current) return;
      
      const duration = videoEl.duration;
      // Skip if duration is not available (NaN, 0, Infinity) - video metadata not loaded yet
      if (!Number.isFinite(duration) || duration <= 0) return;
      
      const ratio = videoEl.currentTime / duration;
      // Skip if ratio is not finite (defensive check)
      if (!Number.isFinite(ratio)) return;
      
      ws.seekTo(ratio);
    };

    if (video) {
      video.addEventListener("timeupdate", handleTimeUpdate);
    }

    // Cleanup
    return () => {
      isUnmounted = true;
      isWaveformReadyRef.current = false;
      if (video) {
        video.removeEventListener("timeupdate", handleTimeUpdate);
      }
      ws?.destroy();
    };
  }, [generateRegions, task.filePath]);

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

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Video Player - always in DOM but hidden when not visible */}
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border bg-black max-w-5xl mx-auto transition-all duration-300",
          isVideoVisible
            ? "animate-in fade-in slide-in-from-top-2"
            : "sr-only"
        )}
      >
        <video
          ref={internalVideoRef}
          src={assetUrl}
          controls={isVideoVisible}
          className="w-full aspect-video object-contain"
        />
      </div>

      {/* Waveform Container */}
      <div className="relative rounded-xl border bg-card overflow-hidden">
        {/* Waveform */}
        <div ref={containerRef} className="w-full" />

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
    </div>
  );
});
