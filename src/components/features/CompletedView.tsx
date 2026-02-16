import { useState, useCallback, useEffect, useRef, useMemo } from "react";

import {
  ChevronDown,
  ChevronUp,
  Search,
  Video,
  VideoOff,
  X,
} from "lucide-react";

import { ExportMenu } from "@/components/features/ExportMenu";
import { ArchiveButton } from "@/components/features/ArchiveButton";
import { TranscriptionSegments } from "@/components/features/TranscriptionSegments";
import { VideoPlayer } from "@/components/features/VideoPlayer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatTime } from "@/lib/utils";
import { sanitizeSegments } from "@/lib/segment-utils";
import { useUIStore } from "@/stores";
import type { TranscriptionTask, WaveformColorMode } from "@/types";
import { MODEL_NAMES } from "@/types";

interface CompletedViewProps {
  task: TranscriptionTask;
}

export function CompletedView({ task }: CompletedViewProps) {
  const displayMode = useUIStore((s) => s.displayMode);
  const setDisplayMode = useUIStore((s) => s.setDisplayMode);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const segmentsContainerRef = useRef<HTMLDivElement>(null);

  const [colorMode, setColorMode] = useState<WaveformColorMode>("segments");
  const [isVideoVisible, setIsVideoVisible] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedSearchIndex, setHighlightedSearchIndex] = useState<number>(-1);
  const selectedSegmentIndexRef = useRef<number | undefined>(selectedSegmentIndex);

  useEffect(() => {
    selectedSegmentIndexRef.current = selectedSegmentIndex;
  }, [selectedSegmentIndex]);

  // Check if video/audio is available
  const hasVideo = !task.videoDeleted && task.filePath && task.filePath.length > 0;

  const sanitizedSegments = useMemo(
    () => sanitizeSegments(task?.result?.segments),
    [task?.result?.segments]
  );

  const sanitizedSpeakerSegments = useMemo(
    () => sanitizeSegments(task?.result?.speakerSegments),
    [task?.result?.speakerSegments]
  );

  const displaySegments = displayMode === "segments"
    ? sanitizedSegments
    : (sanitizedSpeakerSegments.length > 0 ? sanitizedSpeakerSegments : sanitizedSegments);

  const matchingSegmentsCount = useMemo(() => {
    if (!searchQuery || !displaySegments) return 0;
    const query = searchQuery.toLowerCase();
    return displaySegments.filter(segment =>
      segment.text.toLowerCase().includes(query) ||
      (segment.speaker && segment.speaker.toLowerCase().includes(query))
    ).length;
  }, [displaySegments, searchQuery]);

  const handleSegmentClick = useCallback((index: number, startTime: number) => {
    setSelectedSegmentIndex(index);
    setCurrentTime(startTime);
    const videoElement = videoRef.current;
    if (videoElement) {
      videoElement.currentTime = startTime;
    }
  }, []);

  const handlePlayerTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);

    const selectedIndex = selectedSegmentIndexRef.current;
    if (selectedIndex === undefined) {
      return;
    }
    const selectedSegment = selectedIndex !== undefined ? displaySegments[selectedIndex] : undefined;
    if (!selectedSegment || time > selectedSegment.end + 0.05) {
      setSelectedSegmentIndex(undefined);
    }
  }, [displaySegments]);

  const goToPreviousSearch = useCallback(() => {
    if (matchingSegmentsCount === 0) return;
    setHighlightedSearchIndex(prev => prev <= 0 ? matchingSegmentsCount - 1 : prev - 1);
  }, [matchingSegmentsCount]);

  const goToNextSearch = useCallback(() => {
    if (matchingSegmentsCount === 0) return;
    setHighlightedSearchIndex(prev => prev >= matchingSegmentsCount - 1 ? 0 : prev + 1);
  }, [matchingSegmentsCount]);

  const scrollToSegment = useCallback((index: number) => {
    setTimeout(() => {
      const container = segmentsContainerRef.current;
      if (!container) return;

      const segmentElements = container.querySelectorAll<HTMLElement>('[data-segment-index]');
      const targetElement = segmentElements[index];
      if (targetElement) {
        const containerRect = container.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const targetTop = container.scrollTop + (targetRect.top - containerRect.top);
        const centeredTop = targetTop - (container.clientHeight / 2) + (targetElement.clientHeight / 2);

        container.scrollTo({
          top: Math.max(0, centeredTop),
          behavior: "smooth",
        });
      }
    }, 100);
  }, []);

  useEffect(() => {
    setHighlightedSearchIndex(-1);
  }, [searchQuery]);

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

  useEffect(() => {
    setCurrentTime(0);
    setSelectedSegmentIndex(undefined);
    setSearchQuery("");
    setHighlightedSearchIndex(-1);
  }, [task?.id]);

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      <Card className="shrink-0 flex flex-col">
        <CardHeader className="border-b px-4 py-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg truncate">{task.fileName}</CardTitle>
            <div className="flex items-center gap-1">
              {hasVideo && (
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
              )}
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
                <span>{colorMode === "segments" ? "Segments View" : "Speakers View"}</span>
              </button>
              <ExportMenu task={task} />
              <ArchiveButton task={task} />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span>Duration: {formatTime(task.result?.duration ?? 0)}</span>
            <span>Language: {task.result?.language}</span>
            <span>Segments: {sanitizedSegments.length}</span>
            <span>Model: {MODEL_NAMES[task.options.model] || task.options.model}</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <VideoPlayer
            ref={videoRef}
            task={task}
            colorMode={colorMode}
            onTimeUpdate={handlePlayerTimeUpdate}
            isVideoVisible={isVideoVisible}
            className="w-full"
          />
        </CardContent>
      </Card>

      <Card className={cn(
        "flex flex-col min-h-50",
        isVideoVisible ? "shrink-0" : "flex-1"
      )}>
        <CardHeader className="border-b px-4 py-2 shrink-0">
          <div className="flex flex-col gap-3">
            <CardTitle className="text-lg">Transcription</CardTitle>
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
        <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
          {displaySegments && displaySegments.length > 0 ? (
            <div
              className="flex-1 overflow-y-auto"
              onWheel={(e) => e.stopPropagation()}
              ref={segmentsContainerRef}
            >
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
