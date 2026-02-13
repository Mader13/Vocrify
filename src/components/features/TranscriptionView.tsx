import { useState, useCallback, useEffect, useMemo, useRef } from "react";

import { motion, useReducedMotion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Download,
  FileText,
  Hourglass,
  Mic2,
  Palette,
  Pause,
  Play,
  Search,
  Turtle,
  Video,
  VideoOff,
  X,
  Zap,
} from "lucide-react";

import { ExportMenu } from "@/components/features/ExportMenu";
import { ProgressMetricsDisplay } from "@/components/features/ProgressMetrics";
import { StageBadges } from "@/components/features/StageBadges";
import { TranscriptionSegments } from "@/components/features/TranscriptionSegments";
import { VideoPlayer } from "@/components/features/VideoPlayer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressEnhanced } from "@/components/ui/progress-enhanced";
import { cn, formatTime } from "@/lib/utils";
import { useTasks, useUIStore } from "@/stores";
import type { TranscriptionTask, WaveformColorMode } from "@/types";
import { MODEL_CONFIGS, MODEL_NAMES } from "@/types";

function sanitizeSegmentsForView(segments?: NonNullable<TranscriptionTask["result"]>["segments"]) {
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

interface ProcessingViewProps {
  task: TranscriptionTask;
}

const stageConfig = {
  ready: { icon: Clock, label: "Подготовка", color: "text-muted-foreground" },
  loading: { icon: Cpu, label: "Загрузка модели", color: "text-blue-500" },
  downloading: { icon: Download, label: "Скачивание модели", color: "text-blue-500" },
  transcribing: { icon: Mic2, label: "Распознавание речи", color: "text-primary" },
  diarizing: { icon: FileText, label: "Диаризация", color: "text-purple-500" },
  finalizing: { icon: FileText, label: "Финализация", color: "text-green-500" },
};

function QueuedView({ task }: ProcessingViewProps) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="border-b">
        <CardTitle className="text-lg flex items-center gap-2">
          <Hourglass className="h-5 w-5 text-muted-foreground" />
          {task.fileName}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
        {/* Hourglass animation */}
        <div className="relative">
          <div className="w-20 h-20 rounded-full border-4 border-muted flex items-center justify-center">
            <Hourglass className="h-8 w-8 text-muted-foreground animate-pulse" />
          </div>
        </div>

        {/* Queue info */}
        <div className="w-full max-w-md space-y-4 text-center">
          <h3 className="text-lg font-medium">В очереди</h3>
          <p className="text-sm text-muted-foreground">
            Задача ожидает начала обработки. Она будет запущена автоматически, когда освободятся ресурсы.
          </p>
          
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span>Ожидание...</span>
          </div>
        </div>

        {/* File info */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/50 px-4 py-2 rounded-lg">
          <span>Модель: {task.options.model}</span>
          <span className="w-px h-3 bg-border" />
          <span>Устройство: {task.options.device === "cuda" ? "GPU" : "CPU"}</span>
          <span className="w-px h-3 bg-border" />
          <span>Язык: {task.options.language}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ProcessingView({ task }: ProcessingViewProps) {
  const stage = task.stage || "transcribing";
  const normalizedStage = stage === "downloading" ? "loading" : stage;
  const config = stageConfig[normalizedStage as keyof typeof stageConfig] || stageConfig.transcribing;
  const Icon = config.icon;
  const segments = task.result?.segments || [];
  const segmentCount = segments.length;
  const streamingSegments = task.streamingSegments || [];
  const modelConfig = MODEL_CONFIGS[task.options.model];
  const isSlowModel = modelConfig.speedCategory === "slow";
  const shouldReduceMotion = useReducedMotion();

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">
            {task.fileName}
          </CardTitle>
          <motion.div
            className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-xs"
            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.3 }}
          >
            {modelConfig.speedCategory === "fast" && <Zap className="h-3 w-3 text-emerald-400" />}
            {modelConfig.speedCategory === "medium" && <Clock className="h-3 w-3 text-amber-400" />}
            {modelConfig.speedCategory === "slow" && <Turtle className="h-3 w-3 text-rose-400" />}
            <span>{MODEL_NAMES[task.options.model] || task.options.model}</span>
          </motion.div>
        </div>
        <div className="mt-3">
          <StageBadges
            currentStage={normalizedStage}
            enableDiarization={task.options.enableDiarization}
          />
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
        {/* Animated spinner */}
        <div className="relative">
          <div className="w-24 h-24 rounded-full border-4 border-muted" />
          <div
            className="absolute inset-0 w-24 h-24 rounded-full border-4 border-primary border-t-transparent"
            style={{
              animation: "spin 1.5s linear infinite",
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon className={`h-8 w-8 ${config.color}`} />
          </div>
        </div>

        {/* Progress info */}
        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className={`flex items-center gap-2 font-medium ${config.color}`}>
              <Icon className="h-4 w-4" />
              {config.label}
            </span>
            <span className="text-muted-foreground font-mono">{task.progress}%</span>
          </div>

          <ProgressEnhanced value={task.progress} stage={normalizedStage} className="h-3" />

          {task.metrics && <ProgressMetricsDisplay metrics={task.metrics} />}

          <p className="text-center text-sm text-muted-foreground">
            Пожалуйста, подождите. Это может занять несколько минут в зависимости от длительности файла.
          </p>

          {/* Show segment count during transcription */}
          {segmentCount > 0 && (
            <div className="text-center">
              <span className="text-sm font-medium text-primary">
                {segmentCount} {segmentCount === 1 ? 'segment' : 'segments'} transcribed
              </span>
            </div>
          )}
        </div>

        {/* File info */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/50 px-4 py-2 rounded-lg">
          <span>Модель: {task.options.model}</span>
          <span className="w-px h-3 bg-border" />
          <span>Устройство: {task.options.device === "cuda" ? "GPU" : "CPU"}</span>
          <span className="w-px h-3 bg-border" />
          <span>Язык: {task.options.language}</span>
        </div>

        {/* Show latest segments preview if available */}
        {streamingSegments.length > 0 && isSlowModel && (
          <div className="w-full max-w-md max-h-40 overflow-y-auto bg-muted/30 rounded-lg p-3 space-y-2">
            {streamingSegments.slice(-5).map((segment, idx) => (
              <motion.div
                key={idx}
                className="text-xs border-b border-muted/50 last:border-0 pb-1 last:pb-0"
                initial={shouldReduceMotion ? false : { opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: shouldReduceMotion ? 0 : idx * 0.05 }}
              >
                <span className="font-mono text-muted-foreground">
                  {formatTime(segment.start)}
                </span>
                <span className="ml-2">{segment.text}</span>
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Main view for completed transcription with video player
 * Layout: Video player (40%) + Transcription segments (60%)
 */
export function TranscriptionView() {
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const displayMode = useUIStore((s) => s.displayMode);
  const setDisplayMode = useUIStore((s) => s.setDisplayMode);
  const task = useTasks((s) => s.tasks.find((t) => t.id === selectedTaskId));
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptionContainerRef = useRef<HTMLDivElement>(null);

  // Local state for waveform color mode (independent from text display mode)
  const [colorMode, setColorMode] = useState<WaveformColorMode>("segments");
  const [isVideoVisible, setIsVideoVisible] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedSearchIndex, setHighlightedSearchIndex] = useState<number>(-1);

  const sanitizedSegments = useMemo(
    () => sanitizeSegmentsForView(task?.result?.segments),
    [task?.result?.segments]
  );

  const sanitizedSpeakerSegments = useMemo(
    () => sanitizeSegmentsForView(task?.result?.speakerSegments),
    [task?.result?.speakerSegments]
  );

  // Select segments based on display mode
  // Use speakerSegments if available, otherwise fall back to segments (which may have speaker labels)
  const displaySegments = displayMode === "segments"
    ? sanitizedSegments
    : (sanitizedSpeakerSegments.length > 0 ? sanitizedSpeakerSegments : sanitizedSegments);

  // Calculate matching segments count
  const matchingSegmentsCount = displaySegments ? displaySegments.filter(segment =>
    searchQuery && (
      segment.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (segment.speaker && segment.speaker.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  ).length : 0;

  const handleSegmentClick = useCallback((index: number, startTime: number) => {
    setSelectedSegmentIndex(index);
    setCurrentTime(startTime);
    const videoElement = videoRef.current;
    if (videoElement) {
      videoElement.currentTime = startTime;
    }
  }, []);

  // Navigate to previous search result
  const goToPreviousSearch = useCallback(() => {
    if (matchingSegmentsCount === 0) return;
    setHighlightedSearchIndex(prev => prev <= 0 ? matchingSegmentsCount - 1 : prev - 1);
  }, [matchingSegmentsCount]);

  // Navigate to next search result
  const goToNextSearch = useCallback(() => {
    if (matchingSegmentsCount === 0) return;
    setHighlightedSearchIndex(prev => prev >= matchingSegmentsCount - 1 ? 0 : prev + 1);
  }, [matchingSegmentsCount]);

  // Scroll to segment
  const scrollToSegment = useCallback((index: number) => {
    // Find the segment element and scroll to it
    setTimeout(() => {
      const container = transcriptionContainerRef.current;
      if (!container) return;

      const segmentElements = container.querySelectorAll('[class*="border-b"]');
      const targetElement = segmentElements[index];
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  }, []);

  // Reset search highlight when search query changes
  useEffect(() => {
    setHighlightedSearchIndex(-1);
  }, [searchQuery]);

  // Handle keyboard shortcuts for search navigation
  useEffect(() => {
    if (!searchQuery) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          goToPreviousSearch();
        } else {
          goToNextSearch();
        }
      }
      // F3 key
      if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) {
          goToPreviousSearch();
        } else {
          goToNextSearch();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, goToPreviousSearch, goToNextSearch]);

  const togglePlayPause = useCallback(() => {
    const videoElement = videoRef.current;
    if (videoElement) {
      if (videoElement.paused) {
        videoElement.play();
      } else {
        videoElement.pause();
      }
    }
  }, []);

  // Sync play state and time with video
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const handlePlay = () => {
      setIsPlaying(true);
      // Clear selected segment when playback starts to follow video time
      setSelectedSegmentIndex(undefined);
    };
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(videoElement.currentTime);

    videoElement.addEventListener("play", handlePlay);
    videoElement.addEventListener("pause", handlePause);
    videoElement.addEventListener("timeupdate", handleTimeUpdate);

    // Set initial state
    setIsPlaying(!videoElement.paused);
    setCurrentTime(videoElement.currentTime);
    // Reset selected segment and search when task changes
    setSelectedSegmentIndex(undefined);
    setSearchQuery("");
    setHighlightedSearchIndex(-1);

    return () => {
      videoElement.removeEventListener("play", handlePlay);
      videoElement.removeEventListener("pause", handlePause);
      videoElement.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [task?.id]);



  if (!selectedTaskId || !task) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full items-center justify-center p-6">
          <p className="text-muted-foreground">
            Select a task to view transcription
          </p>
        </CardContent>
      </Card>
    );
  }

  if (task.status === "queued") {
    return <QueuedView task={task} />;
  }

  if (task.status === "processing") {
    return <ProcessingView task={task} />;
  }

  if (task.status === "failed") {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg">{task.fileName}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">Error: {task.error}</p>
        </CardContent>
      </Card>
    );
  }

  if (task.status === "cancelled") {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg">{task.fileName}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Task was cancelled
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!task.result) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full items-center justify-center p-6">
          <p className="text-muted-foreground">No transcription data</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      {/* Video Player Section - адаптивная высота */}
      <Card className="shrink-0 flex flex-col">
        <CardHeader className="border-b px-4 py-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg truncate">{task.fileName}</CardTitle>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsVideoVisible(!isVideoVisible)}
                className="h-8 px-2 text-xs font-medium rounded-md hover:bg-muted/60 active:bg-muted/80 transition-all duration-150 flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              >
                {isVideoVisible ? (
                  <>
                    <VideoOff className="h-4 w-4" />
                    <span className="hidden sm:inline">Hide Video</span>
                  </>
                ) : (
                  <>
                    <Video className="h-4 w-4" />
                    <span className="hidden sm:inline">Show Video</span>
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  const newMode = colorMode === "segments" ? "speakers" : "segments";
                  setColorMode(newMode);
                  setDisplayMode(newMode);
                }}
                className={cn(
                  "h-8 px-3 text-xs font-medium rounded-md transition-all duration-150 flex items-center gap-1.5",
                  colorMode === "segments"
                    ? "bg-muted/60 text-muted-foreground hover:bg-muted/80"
                    : "bg-primary/10 text-primary hover:bg-primary/20"
                )}
                title="Toggle waveform color mode"
              >
                <Palette className="h-4 w-4" />
                <span>{colorMode === "segments" ? "Segments View" : "Speakers View"}</span>
              </button>
              <ExportMenu task={task} />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>Duration: {formatTime(task.result.duration || 0)}</span>
            <span>Language: {task.result.language}</span>
            <span>Segments: {sanitizedSegments.length}</span>
            <span>Model: {MODEL_NAMES[task.options.model] || task.options.model}</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <VideoPlayer
            ref={videoRef}
            task={task}
            colorMode={colorMode}
            isVideoVisible={isVideoVisible}
            className="w-full"
          />
        </CardContent>
      </Card>

      {/* Transcription Segments Section */}
      <Card className={cn(
        "flex flex-col min-h-50",
        isVideoVisible ? "shrink-0" : "flex-1"
      )}>
        <CardHeader className="border-b px-4 py-2 shrink-0">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Transcription</CardTitle>
              {!isVideoVisible && (
                <div className="flex items-center gap-3">
                  {/* Video time display */}
                  <div className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-md">
                    <span className="text-foreground font-medium">
                      {formatTime(currentTime)}
                    </span>
                    <span className="text-muted-foreground/60">/</span>
                    <span>
                      {formatTime(task.result?.duration || 0)}
                    </span>
                  </div>
                  {/* Play/Pause button */}
                  <button
                    onClick={togglePlayPause}
                    className={cn(
                      "h-9 px-4 text-sm font-semibold rounded-lg transition-all duration-150 flex items-center gap-2 shadow-sm hover:shadow-md active:scale-95",
                      isPlaying
                        ? "bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700/50"
                        : "bg-primary text-primary-foreground hover:bg-primary/90 border border-primary"
                    )}
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="h-4 w-4" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        <span>Play</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
            {/* Search input with navigation */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search in transcription..."
                  className={cn(
                    "w-full h-9 pl-9 pr-20 text-sm rounded-md border",
                    "bg-background",
                    "border-input",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                    "placeholder:text-muted-foreground",
                    "transition-all duration-150"
                  )}
                />
                {searchQuery && (
                  <>
                    {/* Results counter */}
                    <span className="absolute right-12 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">
                      {matchingSegmentsCount > 0 ? (
                        <span className={cn(
                          "transition-colors",
                          highlightedSearchIndex >= 0 ? "text-primary font-semibold" : ""
                        )}>
                          {highlightedSearchIndex >= 0 ? `${highlightedSearchIndex + 1}` : '0'}/{matchingSegmentsCount}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0/0</span>
                      )}
                    </span>
                    {/* Clear button */}
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-sm hover:bg-muted/60 transition-colors"
                      aria-label="Clear search"
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </>
                )}
              </div>
              {/* Navigation buttons */}
              {searchQuery && matchingSegmentsCount > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={goToPreviousSearch}
                    className={cn(
                      "h-9 px-2 text-sm font-medium rounded-md transition-all duration-150",
                      "hover:bg-muted/60 active:bg-muted/80",
                      "flex items-center gap-1",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    title="Previous result (Shift+F3 or Ctrl+Shift+G)"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={goToNextSearch}
                    className={cn(
                      "h-9 px-2 text-sm font-medium rounded-md transition-all duration-150",
                      "hover:bg-muted/60 active:bg-muted/80",
                      "flex items-center gap-1",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                    title="Next result (F3 or Ctrl+G)"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-hidden flex flex-col" ref={transcriptionContainerRef}>
          {displaySegments && displaySegments.length > 0 ? (
            <div className="flex-1 overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
              <TranscriptionSegments
                segments={displaySegments}
                currentTime={currentTime}
                selectedSegmentIndex={selectedSegmentIndex}
                onSegmentClick={handleSegmentClick}
                isVideoVisible={isVideoVisible}
                searchQuery={searchQuery}
                highlightedSearchIndex={highlightedSearchIndex}
                onScrollToSegment={scrollToSegment}
              />
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center p-6">
              <p className="text-muted-foreground">
                No transcription segments available
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
