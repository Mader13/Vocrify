import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  Languages,
  Pencil,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { ArchiveButton } from "@/components/features/ArchiveButton";
import { ExportMenu } from "@/components/features/ExportMenu";
import { PlayerErrorBoundary } from "@/components/features/PlayerErrorBoundary";
import { SpeakerNamesModal } from "@/components/features/SpeakerNamesModal";
import { TranscriptionSegments } from "@/components/features/TranscriptionSegments";
import { VideoPlayer } from "@/components/features/VideoPlayer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { applySpeakerNameMapToResult, collectSpeakerLabels } from "@/lib/speaker-names";
import { sanitizeSegments } from "@/lib/segment-utils";
import { cn, formatTime } from "@/lib/utils";
import { useTasks, useUIStore } from "@/stores";
import type { TranscriptionTask, WaveformColorMode } from "@/types";
import {
  getCompletedViewLayoutMode,
  type CompletedViewLayoutMode,
} from "@/components/features/completed-view-layout";

interface CompletedViewProps {
  task: TranscriptionTask;
}

interface MetaPillProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}

function MetaPill({ icon: Icon, label, value }: MetaPillProps) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground sm:gap-2 sm:px-2.5 sm:py-1.5 sm:text-xs">
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

const viewModeLabels: Record<"balanced" | "transcript-focus", string> = {
  balanced: "Balanced",
  "transcript-focus": "Transcript focus",
};

const waveformModeLabels: Record<"segments" | "speakers", string> = {
  segments: "Segments",
  speakers: "Speakers",
};

export const CompletedView = React.memo(function CompletedView({ task }: CompletedViewProps) {
  const displayMode = useUIStore((s) => s.displayMode);
  const setDisplayMode = useUIStore((s) => s.setDisplayMode);
  const isSidebarCollapsed = useUIStore((s) => s.isSidebarCollapsed);
  const viewMode = useUIStore((s) => s.completedViewModeByTask[task.id] ?? "balanced");
  const setCompletedViewModeForTask = useUIStore((s) => s.setCompletedViewModeForTask);
  const updateSpeakerNameMap = useTasks((s) => s.updateSpeakerNameMap);
  const updateTaskFileName = useTasks((s) => s.updateTaskFileName);
  const removeTask = useTasks((s) => s.removeTask);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const segmentsContainerRef = useRef<HTMLDivElement>(null);
  const selectedSegmentIndexRef = useRef<number | undefined>(undefined);

  const [currentTime, setCurrentTime] = useState(0);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedSearchIndex, setHighlightedSearchIndex] = useState<number>(-1);
  const [layoutMode, setLayoutMode] = useState<CompletedViewLayoutMode>("stacked");
  const [isSpeakerNamesOpen, setIsSpeakerNamesOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.fileName);

  const mappedResult = useMemo(() => {
    if (!task.result) {
      return null;
    }

    return applySpeakerNameMapToResult(task.result, task.speakerNameMap);
  }, [task.result, task.speakerNameMap]);

  const availableSpeakers = useMemo(
    () => collectSpeakerLabels(task.result),
    [task.result],
  );

  useEffect(() => {
    selectedSegmentIndexRef.current = selectedSegmentIndex;
  }, [selectedSegmentIndex]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateLayoutMode = (width: number) => {
      setLayoutMode(
        getCompletedViewLayoutMode(width, {
          sidebarCollapsed: isSidebarCollapsed,
        }),
      );
    };

    updateLayoutMode(container.clientWidth);

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => updateLayoutMode(container.clientWidth);
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateLayoutMode(entry.contentRect.width);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [isSidebarCollapsed]);

  const sanitizedSegments = useMemo(
    () => sanitizeSegments(mappedResult?.segments),
    [mappedResult?.segments],
  );

  const sanitizedSpeakerSegments = useMemo(
    () => sanitizeSegments(mappedResult?.speakerSegments),
    [mappedResult?.speakerSegments],
  );

  const hasSpeakerData =
    sanitizedSpeakerSegments.length > 0 || (mappedResult?.speakerTurns && mappedResult.speakerTurns.length > 0);

  const waveformMode: WaveformColorMode =
    displayMode === "speakers" && !hasSpeakerData ? "segments" : displayMode;

  const displaySegments = useMemo(() => {
    if (waveformMode === "segments") {
      return sanitizedSegments;
    }

    if (sanitizedSpeakerSegments.length > 0) {
      return sanitizedSpeakerSegments;
    }

    return sanitizedSegments;
  }, [sanitizedSegments, sanitizedSpeakerSegments, waveformMode]);

  const matchingSegmentsCount = useMemo(() => {
    if (!searchQuery || !displaySegments) return 0;
    const query = searchQuery.toLowerCase();
    return displaySegments.filter(
      (segment) =>
        segment.text.toLowerCase().includes(query) ||
        (segment.speaker && segment.speaker.toLowerCase().includes(query)),
    ).length;
  }, [displaySegments, searchQuery]);

  const speakerCount = useMemo(() => {
    const speakers = new Set<string>();

    mappedResult?.speakerTurns?.forEach((turn) => {
      if (turn.speaker?.trim()) {
        speakers.add(turn.speaker);
      }
    });

    sanitizedSpeakerSegments.forEach((segment) => {
      if (segment.speaker?.trim()) {
        speakers.add(segment.speaker);
      }
    });

    return speakers.size;
  }, [mappedResult?.speakerTurns, sanitizedSpeakerSegments]);

  const durationLabel = useMemo(() => {
    if (!task.result?.duration || task.result.duration <= 0) {
      return "--:--";
    }
    return formatTime(task.result.duration);
  }, [task.result?.duration]);

  const languageLabel = useMemo(() => {
    const resultLanguage = task.result?.language;
    if (resultLanguage && resultLanguage.trim().length > 0) {
      return resultLanguage.toUpperCase();
    }
    return task.options.language.toUpperCase();
  }, [task.options.language, task.result?.language]);

  useEffect(() => {
    if (displayMode === "speakers" && !hasSpeakerData) {
      setDisplayMode("segments");
    }
  }, [displayMode, hasSpeakerData, setDisplayMode]);

  const handleSegmentClick = useCallback((index: number, startTime: number) => {
    setSelectedSegmentIndex(index);
    setCurrentTime(startTime);

    const videoElement = videoRef.current;
    if (videoElement) {
      videoElement.currentTime = startTime;
    }
  }, []);

  const handlePlayerTimeUpdate = useCallback(
    (time: number) => {
      setCurrentTime(time);

      const selectedIndex = selectedSegmentIndexRef.current;
      if (selectedIndex === undefined) {
        return;
      }

      const selectedSegment = displaySegments[selectedIndex];
      if (!selectedSegment || time > selectedSegment.end + 0.05) {
        setSelectedSegmentIndex(undefined);
      }
    },
    [displaySegments],
  );

  const goToPreviousSearch = useCallback(() => {
    if (matchingSegmentsCount === 0) return;
    setHighlightedSearchIndex((prev) => (prev <= 0 ? matchingSegmentsCount - 1 : prev - 1));
  }, [matchingSegmentsCount]);

  const goToNextSearch = useCallback(() => {
    if (matchingSegmentsCount === 0) return;
    setHighlightedSearchIndex((prev) => (prev >= matchingSegmentsCount - 1 ? 0 : prev + 1));
  }, [matchingSegmentsCount]);

  const scrollToSegment = useCallback((index: number) => {
    setTimeout(() => {
      const container = segmentsContainerRef.current;
      if (!container) return;

      const segmentElements = container.querySelectorAll<HTMLElement>("[data-segment-index]");
      const targetElement = segmentElements[index];
      if (!targetElement) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      const targetTop = container.scrollTop + (targetRect.top - containerRect.top);
      const centeredTop = targetTop - container.clientHeight / 2 + targetElement.clientHeight / 2;

      container.scrollTo({
        top: Math.max(0, centeredTop),
        behavior: "smooth",
      });
    }, 100);
  }, []);

  useEffect(() => {
    setHighlightedSearchIndex(-1);
  }, [searchQuery]);

  useEffect(() => {
    if (!searchQuery) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === "g") {
        event.preventDefault();
        if (event.shiftKey) {
          goToPreviousSearch();
        } else {
          goToNextSearch();
        }
      }

      if (key === "f3") {
        event.preventDefault();
        if (event.shiftKey) {
          goToPreviousSearch();
        } else {
          goToNextSearch();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToNextSearch, goToPreviousSearch, searchQuery]);

  useEffect(() => {
    setCurrentTime(0);
    setSelectedSegmentIndex(undefined);
    setSearchQuery("");
    setHighlightedSearchIndex(-1);
  }, [task?.id]);

  useEffect(() => {
    setTitleDraft(task.fileName);
    setIsEditingTitle(false);
  }, [task.fileName, task.id]);

  const actionButtonClass =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 text-xs font-medium text-foreground transition-colors motion-safe:duration-150 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-9 sm:px-3";
  const effectiveViewMode = viewMode;
  const showMediaColumn = layoutMode === "stacked" || (layoutMode === "split" && effectiveViewMode === "balanced");
  const showCollapsedMediaBar = layoutMode === "split" && effectiveViewMode === "transcript-focus";
  const collapsedMediaLabel = `${formatTime(currentTime)} / ${durationLabel}`;

  const handleConfirmDelete = useCallback(() => {
    removeTask(task.id);
    setIsDeleteDialogOpen(false);
  }, [removeTask, task.id]);

  const handleSaveTitle = useCallback(() => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setTitleDraft(task.fileName);
      setIsEditingTitle(false);
      return;
    }

    if (nextTitle !== task.fileName) {
      updateTaskFileName(task.id, nextTitle);
    }

    setIsEditingTitle(false);
  }, [task.fileName, task.id, titleDraft, updateTaskFileName]);

  const handleCancelTitleEdit = useCallback(() => {
    setTitleDraft(task.fileName);
    setIsEditingTitle(false);
  }, [task.fileName]);

  const handleTitleInputChange = useCallback((value: string) => {
    setTitleDraft(value);
  }, []);

  const showSpeakerCount = task.options.enableDiarization && (hasSpeakerData || speakerCount > 0);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full min-h-0 flex-col gap-3 sm:gap-4",
        layoutMode === "split" ? "overflow-hidden" : "overflow-y-auto pr-1",
      )}
    >
      <Card className="shrink-0 border-border/70">
        <CardHeader className="border-b border-border/60 px-3 py-3 sm:px-5 sm:py-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div data-testid="title-block" className="min-w-0 flex-1 sm:pr-2">
                {isEditingTitle ? (
                  <div
                    data-testid="title-editor"
                    className="relative flex w-full max-w-none items-start origin-left transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-out"
                  >
                    <input
                      type="text"
                      value={titleDraft}
                      onChange={(event) => handleTitleInputChange(event.target.value)}
                      onBlur={handleSaveTitle}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleSaveTitle();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          handleCancelTitleEdit();
                        }
                      }}
                      className={cn(
                        "h-auto min-h-[1.75rem] w-full border-0 border-b border-border/60 bg-transparent px-0 py-0 text-[15px] font-semibold leading-tight tracking-tight text-foreground",
                        "rounded-none align-top transition-[border-color,color,box-shadow] motion-safe:duration-200",
                        "focus:border-foreground focus:outline-none focus:ring-0 sm:text-lg",
                      )}
                      aria-label="Transcription title"
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="group flex w-full items-start gap-1.5">
                    <CardTitle className="line-clamp-2 break-all text-[15px] font-semibold leading-tight sm:text-lg">
                      {task.fileName}
                    </CardTitle>
                    <button
                      type="button"
                      onClick={() => setIsEditingTitle(true)}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-80 transition-[opacity,color,background-color,transform] motion-safe:duration-200 motion-safe:ease-out motion-safe:hover:scale-105 hover:bg-muted/70 hover:text-foreground group-hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      title="Edit transcription title"
                      aria-label="Edit transcription title"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:shrink-0">
                {hasSpeakerData && (
                  <button
                    type="button"
                    onClick={() => setIsSpeakerNamesOpen(true)}
                    className={cn(actionButtonClass, "h-8 sm:h-9")}
                    title="Rename speakers"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>Speaker&apos;s names</span>
                  </button>
                )}
                <ExportMenu task={task} />
                <ArchiveButton task={task} />
                <button
                  type="button"
                  onClick={() => setIsDeleteDialogOpen(true)}
                  className={cn(
                    actionButtonClass,
                    "border-destructive/40 text-destructive hover:bg-destructive/10",
                  )}
                  title="Delete transcription"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  <MetaPill icon={Clock3} label="Duration" value={durationLabel} />
                  <MetaPill icon={FileText} label="Segments" value={String(displaySegments.length)} />
                  {showSpeakerCount && (
                    <MetaPill icon={UserRound} label="Speakers" value={String(speakerCount)} />
                  )}
                  <MetaPill icon={Languages} label="Language" value={languageLabel} />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {hasSpeakerData && (
                    <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-1.5 py-1">
                      {(["segments", "speakers"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setDisplayMode(mode)}
                          className={cn(
                            "flex items-center justify-center rounded-full px-3 py-1 text-xs font-semibold transition-colors motion-safe:duration-150",
                            displayMode === mode
                              ? "bg-foreground text-card-foreground shadow-[0_4px_12px_rgba(15,23,42,0.3)]"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          aria-pressed={displayMode === mode}
                          title={`Show ${waveformModeLabels[mode]} waveform`}
                        >
                          {waveformModeLabels[mode]}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-1.5 py-1">
                    {(["balanced", "transcript-focus"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCompletedViewModeForTask(task.id, mode)}
                        className={cn(
                          "flex items-center justify-center rounded-full px-3 py-1 text-xs font-semibold transition-colors motion-safe:duration-150",
                          viewMode === mode
                            ? "bg-foreground text-card-foreground shadow-[0_4px_12px_rgba(15,23,42,0.3)]"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        aria-pressed={viewMode === mode}
                      >
                        {viewModeLabels[mode]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
        </CardHeader>
      </Card>

      {showMediaColumn ? (
        <div
          className={cn(
            "grid min-h-0 gap-3 sm:gap-4",
            layoutMode === "split"
              ? "flex-1 grid-cols-[minmax(320px,0.9fr)_minmax(520px,1.1fr)]"
              : "grid-cols-1",
          )}
        >
          <Card
            className={cn(
              "flex flex-col border-border/70",
              layoutMode === "split" && "h-full min-h-0 overflow-hidden",
            )}
          >
            <CardHeader className="border-b border-border/60 px-3 py-3 sm:px-5 sm:py-4">
              <CardTitle className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Media Dock
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2.5 sm:p-4 lg:p-5">
              <PlayerErrorBoundary>
                <VideoPlayer
                  ref={videoRef}
                  task={task}
                  colorMode={waveformMode}
                  onTimeUpdate={handlePlayerTimeUpdate}
                  isVideoVisible
                  className="w-full"
                />
              </PlayerErrorBoundary>
            </CardContent>
          </Card>

          <Card
            className={cn(
              "flex flex-col border-border/70",
              layoutMode === "split" && "h-full min-h-0",
            )}
          >
            <CardHeader className="shrink-0 border-b border-border/60 px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Transcript
                  </CardTitle>
                  <span className="rounded-md border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground sm:px-2.5 sm:text-xs">
                    {displaySegments.length} entries
                  </span>
                </div>

                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search transcript or speaker"
                      className={cn(
                        "h-9 w-full rounded-lg border border-input bg-background px-10 pr-24 text-sm sm:h-10",
                        "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                        "transition-colors motion-safe:duration-150",
                      )}
                    />

                    <span className="absolute right-10 top-1/2 -translate-y-1/2 text-[11px] font-medium tabular-nums text-muted-foreground">
                      {searchQuery &&
                        `${highlightedSearchIndex >= 0 ? highlightedSearchIndex + 1 : 0}/${matchingSegmentsCount}`
                      }
                    </span>

                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="ml-auto flex items-center gap-1 rounded-lg border border-border/70 bg-background/70 p-1">
                    <button
                      type="button"
                      onClick={goToPreviousSearch}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                      title="Previous result (Shift+F3 or Ctrl+Shift+G)"
                      disabled={!searchQuery || matchingSegmentsCount === 0}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={goToNextSearch}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                      title="Next result (F3 or Ctrl+G)"
                      disabled={!searchQuery || matchingSegmentsCount === 0}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent
              className={cn(
                "flex flex-col p-0",
                layoutMode === "split" && "min-h-0 flex-1",
              )}
            >
              {displaySegments.length > 0 ? (
                <div
                  ref={segmentsContainerRef}
                  className={cn(layoutMode === "split" && "flex-1 min-h-0")}
                >
                  <TranscriptionSegments
                    segments={displaySegments}
                    currentTime={currentTime}
                    selectedSegmentIndex={selectedSegmentIndex}
                    onSegmentClick={handleSegmentClick}
                    isVideoVisible={showMediaColumn}
                    layoutMode={layoutMode}
                    searchQuery={searchQuery}
                    highlightedSearchIndex={highlightedSearchIndex}
                    onScrollToSegment={scrollToSegment}
                  />
                </div>
              ) : (
                <div className="flex h-36 items-center justify-center px-6 text-center">
                  <p className="text-sm text-muted-foreground">No transcription segments available for this task.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {showCollapsedMediaBar && (
            <Card className="border-border/70">
              <CardContent className="flex flex-col gap-2 p-2.5 sm:p-3">
                <div className="flex items-center gap-3 px-0.5">
                  <div className="leading-tight">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Media preview</p>
                    <p className="mt-0.5 text-sm font-mono text-foreground tabular-nums">{collapsedMediaLabel}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-card/80">
                  <PlayerErrorBoundary>
                    <VideoPlayer
                      ref={videoRef}
                      task={task}
                      colorMode={waveformMode}
                      onTimeUpdate={handlePlayerTimeUpdate}
                      isVideoVisible={false}
                      className="w-full gap-0"
                    />
                  </PlayerErrorBoundary>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="flex min-h-0 flex-col border-border/70">
            <CardHeader className="shrink-0 border-b border-border/60 px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Transcript
                  </CardTitle>
                  <span className="rounded-md border border-border/70 bg-background/70 px-2 py-1 text-[11px] text-muted-foreground sm:px-2.5 sm:text-xs">
                    {displaySegments.length} entries
                  </span>
                </div>

                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search transcript or speaker"
                      className={cn(
                        "h-9 w-full rounded-lg border border-input bg-background px-10 pr-24 text-sm sm:h-10",
                        "placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                        "transition-colors motion-safe:duration-150",
                      )}
                    />

                    <span className="absolute right-10 top-1/2 -translate-y-1/2 text-[11px] font-medium tabular-nums text-muted-foreground">
                      {searchQuery &&
                        `${highlightedSearchIndex >= 0 ? highlightedSearchIndex + 1 : 0}/${matchingSegmentsCount}`
                      }
                    </span>

                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                        aria-label="Clear search"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="ml-auto flex items-center gap-1 rounded-lg border border-border/70 bg-background/70 p-1">
                    <button
                      type="button"
                      onClick={goToPreviousSearch}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                      title="Previous result (Shift+F3 or Ctrl+Shift+G)"
                      disabled={!searchQuery || matchingSegmentsCount === 0}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={goToNextSearch}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                      title="Next result (F3 or Ctrl+G)"
                      disabled={!searchQuery || matchingSegmentsCount === 0}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              {displaySegments.length > 0 ? (
                <div
                  ref={segmentsContainerRef}
                  className="flex-1 min-h-0"
                >
                  <TranscriptionSegments
                    segments={displaySegments}
                    currentTime={currentTime}
                    selectedSegmentIndex={selectedSegmentIndex}
                    onSegmentClick={handleSegmentClick}
                    isVideoVisible={false}
                    layoutMode={layoutMode}
                    searchQuery={searchQuery}
                    highlightedSearchIndex={highlightedSearchIndex}
                    onScrollToSegment={scrollToSegment}
                  />
                </div>
              ) : (
                <div className="flex h-36 items-center justify-center px-6 text-center">
                  <p className="text-sm text-muted-foreground">No transcription segments available for this task.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <SpeakerNamesModal
        open={isSpeakerNamesOpen}
        onOpenChange={setIsSpeakerNamesOpen}
        speakers={availableSpeakers}
        speakerNameMap={task.speakerNameMap ?? {}}
        onSave={(speakerNameMap) => {
          updateSpeakerNameMap(task.id, speakerNameMap);
        }}
      />

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Transcription?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this transcription? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)}>
                Cancel
              </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
