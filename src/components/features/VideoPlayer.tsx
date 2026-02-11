import * as React from "react";
import { useEffect, useRef, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getThemeColors, cacheWaveformPeaks, getCachedWaveformPeaks } from "@/lib/utils";
import { getAssetUrl, readFileAsBase64 } from "@/services/tauri";
import type { TranscriptionTask, WaveformColorMode } from "@/types";

/**
 * Convert base64 string to Blob
 */
function base64ToBlob(base64: string, mimeType: string = "audio/wav"): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
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
    if (!ws || !regions || !task.result?.segments) return;

    // Clear existing regions
    regions.clearRegions();

    const { segments } = task.result;

    if (colorMode === "segments") {
      // Use rainbow palette for segments
      segments.forEach((segment, index) => {
        const color = RAINBOW_PALETTE[index % RAINBOW_PALETTE.length];
        regions.addRegion({
          start: segment.start,
          end: segment.end,
          color: color + "40", // 25% opacity
          drag: false,
          resize: false,
        });
      });
    } else if (colorMode === "speakers") {
      // Group by speaker with consistent colors
      // Sort speakers to ensure consistent ordering
      const speakers = Array.from(
        new Set(segments.map((s) => s.speaker).filter((s) => s !== null))
      ).sort();

      const themeColors = getThemeColors();

      // Create a Map for consistent speaker-to-color mapping
      const speakerColorMap = new Map<string, string>();
      speakers.forEach((speaker, index) => {
        const color = themeColors.chartColors[index % themeColors.chartColors.length];
        speakerColorMap.set(speaker, color);
      });

      // Default color for segments without speaker information
      const defaultColor = themeColors.chartColors[0];

      segments.forEach((segment) => {
        // Use speaker color if available, otherwise use default color
        const color = segment.speaker && speakerColorMap.has(segment.speaker)
          ? speakerColorMap.get(segment.speaker)!
          : defaultColor;

        regions.addRegion({
          start: segment.start,
          end: segment.end,
          color: color + "40", // 25% opacity
          drag: false,
          resize: false,
        });
      });
    }
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

    // Check for cached peaks
    const cachedPeaks = getCachedWaveformPeaks(task.filePath);
    console.log("[VideoPlayer DEBUG] Cached peaks:", !!cachedPeaks);

    // Register regions plugin
    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

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
      plugins: [regions],
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
    let ws: WaveSurfer;
    try {
      ws = WaveSurfer.create(wsOptions);
      wavesurferRef.current = ws;
      console.log("[VideoPlayer DEBUG] WaveSurfer created successfully");
    } catch (error) {
      console.error("[VideoPlayer DEBUG] Failed to create WaveSurfer:", error);
      return;
    }

    if (cachedPeaks) {
      setIsGenerating(false);
    } else {
      setIsGenerating(true);
    }

    // Load audio file as Blob (workaround for Tauri asset URL CORS issue)
    console.log("[VideoPlayer DEBUG] Loading audio as Blob...");
    readFileAsBase64(task.filePath)
      .then((result) => {
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
      console.log("[VideoPlayer DEBUG] WaveSurfer ready event fired");
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

      // Generate regions
      generateRegions();
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
    regions.on("region-clicked", (region: any) => {
      const videoEl = internalVideoRef.current;
      if (videoEl) {
        videoEl.currentTime = region.start;
        if (videoEl.paused) {
          videoEl.play();
        }
      }
    });

    // Event: Waveform click - seek video
    ws.on("interaction", (position: number) => {
      const videoEl = internalVideoRef.current;
      if (videoEl) {
        videoEl.currentTime = position;
      }
    });

    // Event: Video time update - sync waveform
    const handleTimeUpdate = () => {
      const videoEl = internalVideoRef.current;
      if (!videoEl || !ws || !isWaveformReady) return;
      
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
      if (video) {
        video.removeEventListener("timeupdate", handleTimeUpdate);
      }
      ws.destroy();
    };
  }, [generateRegions, task.filePath]);

  // Regenerate regions when color mode or result changes
  useEffect(() => {
    if (isWaveformReady) {
      generateRegions();
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
