import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleDashed,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  HardDrive,
  Languages,
  LocateFixed,
  Pencil,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import { ArchiveButton } from "@/components/features/ArchiveButton";
import { ExportMenu } from "@/components/features/ExportMenu";
import { PlayerErrorBoundary } from "@/components/features/PlayerErrorBoundary";
import { DeleteTaskDialog } from "@/components/features/DeleteTaskDialog";
import { SpeakerNamesModal } from "@/components/features/SpeakerNamesModal";
import { TranscriptionSegments, type TranscriptionSegmentsHandle } from "@/components/features/TranscriptionSegments";
import { VideoPlayer, type VideoPlayerHandle } from "@/components/features/VideoPlayer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { applySpeakerNameMapToResult, collectSpeakerLabels } from "@/lib/speaker-names";
import { sanitizeSegments } from "@/lib/segment-utils";
import { cn, formatTime, isVideoFile } from "@/lib/utils";
import { useI18n } from "@/hooks";
import { useTasks, useUIStore } from "@/stores";
import type { TranscriptionTask, WaveformColorMode } from "@/types";
import {
  getCompletedViewLayoutMode,
  getCompletedViewSplitThreshold,
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



export const CompletedView = React.memo(function CompletedView({ task }: CompletedViewProps) {
  const { t } = useI18n();

  const viewModeLabels: Record<"balanced" | "transcript-focus", string> = {
    balanced: t("completed.balanced"),
    "transcript-focus": t("completed.transcriptFocus"),
  };

  const waveformModeLabels: Record<"clean" | "speakers", string> = {
    clean: t("completed.clean"),
    speakers: t("completed.speakers"),
  };

  const LAYOUT_MODE_HYSTERESIS_PX = 48;
  const displayMode = useUIStore((s) => s.displayMode);
  const setDisplayMode = useUIStore((s) => s.setDisplayMode);
  const isSidebarCollapsed = useUIStore((s) => s.isSidebarCollapsed);
  const viewMode = useUIStore((s) => s.completedViewModeByTask[task.id] ?? "balanced");
  const setCompletedViewModeForTask = useUIStore((s) => s.setCompletedViewModeForTask);
  const updateSpeakerNameMap = useTasks((s) => s.updateSpeakerNameMap);
  const updateTaskFileName = useTasks((s) => s.updateTaskFileName);
  const removeTask = useTasks((s) => s.removeTask);

  const videoRef = useRef<VideoPlayerHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const segmentsContainerRef = useRef<HTMLDivElement>(null);
  const transcriptionSegmentsRef = useRef<TranscriptionSegmentsHandle>(null);
  const selectedSegmentIndexRef = useRef<number | undefined>(undefined);
  const currentTimeRef = useRef(0);

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
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateLayoutMode = (width: number) => {
      const options = { sidebarCollapsed: isSidebarCollapsed };
      const splitThreshold = getCompletedViewSplitThreshold(options);

      setLayoutMode((previousMode) => {
        if (previousMode === "split") {
          return width < splitThreshold - LAYOUT_MODE_HYSTERESIS_PX ? "stacked" : "split";
        }
        return width >= splitThreshold + LAYOUT_MODE_HYSTERESIS_PX
          ? "split"
          : getCompletedViewLayoutMode(width, undefined, options);
      });
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

  const mediaSourcePath = task.managedCopyPath ?? (!task.archived
    ? task.filePath
    : task.archiveMode === "keep_all"
      ? task.filePath
      : task.archiveMode === "delete_video"
        ? task.audioPath
        : undefined);

  const hasMediaSource = Boolean(mediaSourcePath);

  const canUseSpeakerWaveform = hasSpeakerData && hasMediaSource;

  const waveformMode: WaveformColorMode =
    displayMode === "speakers" && canUseSpeakerWaveform ? "speakers" : "clean";

  const displaySegments = useMemo(() => {
    if (waveformMode === "clean") {
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

  const managedCopyLabel = useMemo(() => {
    if (task.managedCopyStatus === "done" && task.managedCopyPath) {
      return t("completed.managedCopyReady");
    }
    if (task.managedCopyStatus === "pending") {
      return t("completed.managedCopyPending");
    }
    if (task.managedCopyStatus === "failed") {
      return t("completed.managedCopyFailed");
    }
    return t("completed.managedCopyLegacy");
  }, [task.managedCopyPath, task.managedCopyStatus, t]);

  const managedCopyIcon = task.managedCopyStatus === "pending" ? CircleDashed : HardDrive;

  useEffect(() => {
    if (displayMode === "speakers" && !canUseSpeakerWaveform) {
      setDisplayMode("clean");
    }
  }, [displayMode, canUseSpeakerWaveform, setDisplayMode]);

  const handleSegmentClick = useCallback((index: number, startTime: number) => {
    setSelectedSegmentIndex(index);
    setCurrentTime(startTime);
    currentTimeRef.current = startTime;

    const player = videoRef.current;
    if (player) {
      player.seekTo(startTime);
    }
  }, []);

  const handlePlayerTimeUpdate = useCallback(
    (time: number) => {
      if (Math.abs(time - currentTimeRef.current) >= 0.12) {
        setCurrentTime(time);
        currentTimeRef.current = time;
      }

      const selectedIndex = selectedSegmentIndexRef.current;
      if (selectedIndex === undefined) {
        return;
      }

      const selectedSegment = displaySegments[selectedIndex];
      if (!selectedSegment || time > selectedSegment.end + 0.05 || time < selectedSegment.start - 0.05) {
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

  const scrollToActiveSegment = useCallback(() => {
    transcriptionSegmentsRef.current?.scrollToActive();
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
    currentTimeRef.current = 0;
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
  const hasVideoSource = mediaSourcePath ? isVideoFile(mediaSourcePath) : false;
  const canRenderVideoElement = Boolean(mediaSourcePath) && hasVideoSource;
  const hasVisibleVideoSource = hasVideoSource && canRenderVideoElement;
  const effectiveViewMode = hasVisibleVideoSource ? viewMode : "transcript-focus";
  const isVideoVisible = effectiveViewMode !== "transcript-focus";
  const showMediaDock = hasMediaSource;
  const showMediaColumn = showMediaDock && effectiveViewMode === "balanced" && (layoutMode === "stacked" || layoutMode === "split");
  const shouldShowWaveformControls = !isVideoVisible || !canRenderVideoElement;

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
                        "h-auto min-h-7 w-full border-0 border-b border-border/60 bg-transparent px-0 py-0 text-[15px] font-semibold leading-tight tracking-tight text-foreground",
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
                      title={t("completed.editTitle")}
                      aria-label={t("completed.editTitle")}
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
                    title={t("completed.renameSpeakers")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>{t("completed.speakerNames")}</span>
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
                  title={t("completed.deleteTranscription")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t("common.delete")}</span>
                </button>
              </div>
            </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  <MetaPill icon={Clock3} label={t("completed.duration")} value={durationLabel} />
                  <MetaPill icon={FileText} label={t("completed.segments")} value={String(displaySegments.length)} />
                  {showSpeakerCount && (
                    <MetaPill icon={UserRound} label={t("completed.speakers")} value={String(speakerCount)} />
                  )}
                  <MetaPill icon={Languages} label={t("completed.language")} value={languageLabel} />
                  <MetaPill icon={managedCopyIcon} label={t("completed.mediaSource")} value={managedCopyLabel} />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {canUseSpeakerWaveform && (
                    <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-1.5 py-1">
                      {(["clean", "speakers"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setDisplayMode(mode)}
                          className={cn(
                            "flex items-center justify-center rounded-full px-3 py-1 text-xs font-semibold transition-colors motion-safe:duration-150",
                            displayMode === mode
                              ? "bg-primary text-primary-foreground shadow-[0_4px_12px_rgba(15,23,42,0.3)]"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          aria-pressed={displayMode === mode}
                          title={`${t("completed.showWaveform")} ${waveformModeLabels[mode]}`}
                        >
                          {waveformModeLabels[mode]}
                        </button>
                      ))}
                    </div>
                  )}

                  {hasVisibleVideoSource && (
                    <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-1.5 py-1">
                      {(["balanced", "transcript-focus"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setCompletedViewModeForTask(task.id, mode);
                          }}
                          className={cn(
                            "flex items-center justify-center rounded-full px-3 py-1 text-xs font-semibold transition-colors motion-safe:duration-150",
                            viewMode === mode
                              ? "bg-primary text-primary-foreground shadow-[0_4px_12px_rgba(15,23,42,0.3)]"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          aria-pressed={viewMode === mode}
                        >
                          {viewModeLabels[mode]}
                        </button>
                      ))}
                    </div>
                  )}
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
              "flex flex-col border border-border/60 bg-card/40 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_12px_48px_rgba(0,0,0,0.4)]",
              layoutMode === "split" && "h-full min-h-0",
            )}
          >
            <CardHeader className="shrink-0 border-b border-border/10 px-3 py-2.5 sm:px-5 sm:py-3">
              <CardTitle className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
                {t("completed.mediaDock")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2.5 sm:p-4 lg:p-5">
              <PlayerErrorBoundary>
                <VideoPlayer
                  ref={videoRef}
                  task={task}
                  colorMode={waveformMode}
                  onTimeUpdate={handlePlayerTimeUpdate}
                  isVideoVisible={isVideoVisible}
                  showControls={shouldShowWaveformControls}
                  className="w-full"
                />
              </PlayerErrorBoundary>
            </CardContent>
          </Card>

          <Card
            className={cn(
              "flex flex-col border-transparent bg-transparent shadow-none",
              layoutMode === "split" && "h-full min-h-0",
            )}
          >
            <CardHeader className="shrink-0 border-b border-border/30 px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2 pb-1">
                  <CardTitle className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
                    {t("completed.transcript")}
                  </CardTitle>
                  <span className="rounded-md border border-border/40 bg-transparent px-2 py-1 text-[11px] font-medium text-muted-foreground sm:px-2.5 sm:text-xs">
                    {displaySegments.length} {t("completed.entries")}
                  </span>
                </div>

                <div className="flex w-full items-center gap-2 mt-1 sm:mt-2">
                  <div className="flex flex-1 items-center overflow-hidden rounded-full border border-border/40 backdrop-blur-md bg-muted/20 transition-all duration-300 focus-within:border-primary/50 focus-within:bg-background/80 focus-within:shadow-sm h-10 sm:h-11 shadow-sm">
                    <div className="flex h-full items-center justify-center pl-4 pr-3 text-muted-foreground">
                      <Search className="h-4 w-4" />
                    </div>
                    <div className="relative flex-1 h-full">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder={t("completed.searchTranscript")}
                        className="h-full w-full bg-transparent px-1 text-sm font-medium placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0"
                      />
                      {searchQuery && (
                        <span className="absolute right-9 top-1/2 -translate-y-1/2 text-[11px] font-medium tabular-nums text-muted-foreground opacity-70">
                          {highlightedSearchIndex >= 0 ? highlightedSearchIndex + 1 : 0}/{matchingSegmentsCount}
                        </span>
                      )}
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery("")}
                          className="absolute right-1 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                          aria-label={t("completed.clearSearch")}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-0.5 pr-2 pl-2 h-6">
                      <button
                        type="button"
                        onClick={goToPreviousSearch}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                        title={t("completed.prevResult")}
                        disabled={!searchQuery || matchingSegmentsCount === 0}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={goToNextSearch}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                        title={t("completed.nextResult")}
                        disabled={!searchQuery || matchingSegmentsCount === 0}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={scrollToActiveSegment}
                    className={cn(
                      actionButtonClass,
                      "shrink-0 h-10 sm:h-11 gap-1.5 px-3",
                    )}
                    title={t("completed.scrollToActive")}
                    aria-label={t("completed.scrollToActive")}
                  >
                    <LocateFixed className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t("completed.locate")}</span>
                  </button>
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
                    ref={transcriptionSegmentsRef}
                    segments={displaySegments}
                    currentTime={currentTime}
                    selectedSegmentIndex={selectedSegmentIndex}
                    onSegmentClick={handleSegmentClick}
                    isVideoVisible={isVideoVisible}
                    layoutMode={layoutMode}
                    searchQuery={searchQuery}
                    highlightedSearchIndex={highlightedSearchIndex}
                    onScrollToSegment={scrollToSegment}
                  />
                </div>
              ) : (
                <div className="flex h-36 items-center justify-center px-6 text-center">
                  <p className="text-sm text-muted-foreground">{t("completed.noSegments")}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          {showMediaDock && (
            <Card className="border border-border/60 bg-card/40 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_12px_48px_rgba(0,0,0,0.4)]">
              <CardHeader className="shrink-0 border-b border-border/10 px-3 py-2.5 sm:px-5 sm:py-3">
                <CardTitle className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
                  {t("completed.mediaDock")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-2.5 sm:p-4 lg:p-5">
                <PlayerErrorBoundary>
                  <VideoPlayer
                    ref={videoRef}
                    task={task}
                    colorMode={waveformMode}
                    onTimeUpdate={handlePlayerTimeUpdate}
                    isVideoVisible={false}
                    showControls={shouldShowWaveformControls}
                    className="w-full"
                  />
                </PlayerErrorBoundary>
              </CardContent>
            </Card>
          )}

          <Card className="flex min-h-0 flex-col border-transparent bg-transparent shadow-none">
            <CardHeader className="shrink-0 border-b border-border/30 px-3 py-3 sm:px-5 sm:py-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2 pb-1">
                  <CardTitle className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground/80">
                    {t("completed.transcript")}
                  </CardTitle>
                  <span className="rounded-md border border-border/40 bg-transparent px-2 py-1 text-[11px] font-medium text-muted-foreground sm:px-2.5 sm:text-xs">
                    {displaySegments.length} {t("completed.entries")}
                  </span>
                </div>

                <div className="flex w-full items-center gap-2 mt-1 sm:mt-2">
                  <div className="flex flex-1 items-center overflow-hidden rounded-full border border-border/40 backdrop-blur-md bg-muted/20 transition-all duration-300 focus-within:border-primary/50 focus-within:bg-background/80 focus-within:shadow-sm h-10 sm:h-11 shadow-sm">
                    <div className="flex h-full items-center justify-center pl-4 pr-3 text-muted-foreground">
                      <Search className="h-4 w-4" />
                    </div>
                    <div className="relative flex-1 h-full">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder={t("completed.searchTranscript")}
                        className="h-full w-full bg-transparent px-1 text-sm font-medium placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0"
                      />
                      {searchQuery && (
                        <span className="absolute right-9 top-1/2 -translate-y-1/2 text-[11px] font-medium tabular-nums text-muted-foreground opacity-70">
                          {highlightedSearchIndex >= 0 ? highlightedSearchIndex + 1 : 0}/{matchingSegmentsCount}
                        </span>
                      )}
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery("")}
                          className="absolute right-1 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                          aria-label={t("completed.clearSearch")}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-0.5 pr-2 pl-2 h-6">
                      <button
                        type="button"
                        onClick={goToPreviousSearch}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                        title={t("completed.prevResult")}
                        disabled={!searchQuery || matchingSegmentsCount === 0}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={goToNextSearch}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                        title={t("completed.nextResult")}
                        disabled={!searchQuery || matchingSegmentsCount === 0}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={scrollToActiveSegment}
                    className={cn(
                      actionButtonClass,
                      "shrink-0 h-10 sm:h-11 gap-1.5 px-3",
                    )}
                    title={t("completed.scrollToActive")}
                    aria-label={t("completed.scrollToActive")}
                  >
                    <LocateFixed className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t("completed.locate")}</span>
                  </button>
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
                    ref={transcriptionSegmentsRef}
                    segments={displaySegments}
                    currentTime={currentTime}
                    selectedSegmentIndex={selectedSegmentIndex}
                    onSegmentClick={handleSegmentClick}
                    isVideoVisible={isVideoVisible}
                    layoutMode={layoutMode}
                    searchQuery={searchQuery}
                    highlightedSearchIndex={highlightedSearchIndex}
                    onScrollToSegment={scrollToSegment}
                  />
                </div>
              ) : (
                <div className="flex h-36 items-center justify-center px-6 text-center">
                  <p className="text-sm text-muted-foreground">{t("completed.noSegments")}</p>
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

      <DeleteTaskDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
});
