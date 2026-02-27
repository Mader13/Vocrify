import React, { useEffect, useMemo, useState } from "react";

import { motion } from "framer-motion";
import {
  Check,
  Circle,
  Clock,
  Cpu,
  Download,
  FileText,
  Loader2,
  Mic2,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/hooks";
import type { TranslateFn } from "@/i18n";
import { cn, formatTime } from "@/lib/utils";
import type { TranscriptionTask } from "@/types";

interface ProcessingViewProps {
  task: TranscriptionTask;
}

type StageKey = "ready" | "loading" | "downloading" | "transcribing" | "diarizing" | "finalizing";
type TimelineStage = "loading" | "transcribing" | "diarizing" | "finalizing";

const STAGE_ORDER_WITH_DIARIZATION: readonly TimelineStage[] = [
  "loading",
  "transcribing",
  "diarizing",
  "finalizing",
];

const STAGE_ORDER_BASE: readonly TimelineStage[] = ["loading", "transcribing", "finalizing"];

function buildStageConfig(t: TranslateFn): Record<
  StageKey,
  { icon: typeof Cpu; label: string; accent: string; iconClass: string }
> {
  return {
    ready: {
      icon: Clock,
      label: t("processing.preparing"),
      accent: "border-muted",
      iconClass: "text-muted-foreground",
    },
    loading: {
      icon: Cpu,
      label: t("processing.loadingModel"),
      accent: "border-sky-400/40",
      iconClass: "text-sky-400",
    },
    downloading: {
      icon: Download,
      label: t("processing.downloadingModel"),
      accent: "border-sky-400/40",
      iconClass: "text-sky-400",
    },
    transcribing: {
      icon: Mic2,
      label: t("processing.speechRecognition"),
      accent: "border-orange-400/40",
      iconClass: "text-orange-400",
    },
    diarizing: {
      icon: FileText,
      label: t("processing.speakerDiarization"),
      accent: "border-lime-400/40",
      iconClass: "text-lime-400",
    },
    finalizing: {
      icon: Check,
      label: t("processing.finalizing"),
      accent: "border-emerald-400/40",
      iconClass: "text-emerald-400",
    },
  };
}

function buildStageDescriptions(t: TranslateFn): Record<StageKey, string> {
  return {
    ready: t("processing.preparingDesc"),
    loading: t("processing.loadingModelDesc"),
    downloading: t("processing.downloadingModelDesc"),
    transcribing: t("processing.speechRecognitionDesc"),
    diarizing: t("processing.speakerDiarizationDesc"),
    finalizing: t("processing.finalizingDesc"),
  };
}

function getDeviceLabel(device: TranscriptionTask["options"]["device"]): string {
  if (device === "cuda") return "CUDA";
  if (device === "mps") return "MPS";
  if (device === "vulkan") return "Vulkan";
  return "CPU";
}

function getTimelineStages(enableDiarization: boolean): readonly TimelineStage[] {
  return enableDiarization ? STAGE_ORDER_WITH_DIARIZATION : STAGE_ORDER_BASE;
}

const VALID_STAGE_KEYS: ReadonlySet<string> = new Set<StageKey>(["ready", "loading", "downloading", "transcribing", "diarizing", "finalizing"]);

function normalizeStage(stage: string | undefined, status: TranscriptionTask["status"]): StageKey {
  const sourceStage = stage ?? (status === "completed" ? "finalizing" : "transcribing");

  if (sourceStage === "downloading") {
    return "loading";
  }

  if (sourceStage === "diarization") {
    return "diarizing";
  }

  if (VALID_STAGE_KEYS.has(sourceStage)) {
    return sourceStage as StageKey;
  }

  return "transcribing";
}

interface StageRailProps {
  stages: readonly TimelineStage[];
  currentIndex: number;
  stageConfig: ReturnType<typeof buildStageConfig>;
  t: TranslateFn;
}

function StageRail({ stages, currentIndex, stageConfig, t }: StageRailProps) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-3 sm:p-5">
      <ol className="space-y-2 sm:space-y-3">
        {stages.map((stageKey, index) => {
          const config = stageConfig[stageKey];
          const Icon = config.icon;
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const isFuture = index > currentIndex;
          const isDiarizing = isCurrent && stageKey === "diarizing";

          return (
            <motion.li
              key={stageKey}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.07 }}
              className={cn(
                "relative flex items-center gap-2 rounded-xl border px-2.5 py-2.5 sm:gap-3 sm:px-4 sm:py-3 transition-all duration-300",
                isCurrent && "border-foreground/20 bg-accent/50 shadow-sm",
                isComplete && "border-emerald-500/25 bg-emerald-500/5",
                isFuture && "border-border/60 bg-transparent",
                isDiarizing && "border-lime-500/30 bg-lime-500/5",
              )}
            >
              <div
                className={cn(
                  "relative flex h-8 w-8 items-center justify-center rounded-full border sm:h-9 sm:w-9",
                  isCurrent && cn("bg-background", config.accent),
                  isComplete && "border-emerald-500/35 bg-emerald-500/10",
                  isFuture && "border-border bg-background",
                )}
              >
                {isComplete ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : isCurrent ? (
                  <>
                    <Icon className={cn("h-4 w-4", config.iconClass)} />
                    {isDiarizing && (
                      <motion.div
                        className="absolute inset-0 rounded-full bg-lime-400/10"
                        initial={{ opacity: 0.6, scale: 1 }}
                        animate={{ opacity: 0, scale: 1.5 }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                      />
                    )}
                  </>
                ) : (
                  <Circle className="h-3 w-3 text-muted-foreground" />
                )}
                {isCurrent && !isDiarizing && (
                  <motion.div
                    className={cn("absolute inset-0 rounded-full border", config.accent)}
                    initial={{ opacity: 0.5, scale: 1 }}
                    animate={{ opacity: 0, scale: 1.25 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-xs font-medium sm:text-sm",
                    isFuture ? "text-muted-foreground" : "text-foreground",
                    isDiarizing && "text-lime-700 dark:text-lime-400",
                  )}
                >
                  {config.label}
                </p>
                <p className="text-[11px] text-muted-foreground sm:text-xs">{t("processing.step")} {index + 1}</p>
              </div>

              {isCurrent && (
                <Loader2
                  className={cn(
                    "h-4 w-4 shrink-0 animate-spin",
                    isDiarizing ? "text-lime-500" : "text-muted-foreground"
                  )}
                />
              )}
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

export const ProcessingView = React.memo(function ProcessingView({ task }: ProcessingViewProps) {
  const { t } = useI18n();

  const stageConfig = useMemo(() => buildStageConfig(t), [t]);
  const stageDescriptions = useMemo(() => buildStageDescriptions(t), [t]);

  const normalizedStage = normalizeStage(task.stage as string | undefined, task.status);
  const config = stageConfig[normalizedStage] ?? stageConfig.transcribing;
  const Icon = config.icon;
  const streamingSegments = task.streamingSegments ?? [];

  const stages = getTimelineStages(task.options.enableDiarization);
  const fallbackIndex = stages.indexOf("transcribing");
  const stageIndex = stages.indexOf(normalizedStage as TimelineStage);
  const currentIndex = stageIndex >= 0 ? stageIndex : fallbackIndex;
  const currentStep = currentIndex + 1;

  // Dynamic message for diarization stage
  const isDiarizing = normalizedStage === "diarizing";
  const customMessage = isDiarizing ? t("processing.linkingVoices") : undefined;

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!task.startedAt) {
      setElapsedSeconds(0);
      return;
    }

    const startTimestamp = new Date(task.startedAt).getTime();
    const getElapsed = () => Math.max(0, Math.floor((Date.now() - startTimestamp) / 1000));

    setElapsedSeconds(getElapsed());
    const interval = setInterval(() => {
      setElapsedSeconds(getElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [task.startedAt, task.status]);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/70">
      <CardHeader className="border-b border-border/60 p-3 sm:p-5 lg:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="max-w-full break-words text-sm font-semibold leading-tight sm:text-base lg:text-lg">
              {task.fileName}
            </CardTitle>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 sm:p-5 lg:p-6">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
          <div className="order-2 xl:order-1">
            <StageRail stages={stages} currentIndex={currentIndex} stageConfig={stageConfig} t={t} />
          </div>

          <div className="order-1 flex min-w-0 flex-col gap-3 sm:gap-4 xl:order-2">
            <motion.div
              key={normalizedStage}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5 lg:p-6"
            >
              <div className="flex items-start gap-3 sm:gap-4">
                <div
                  className={cn(
                    "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border bg-background sm:h-11 sm:w-11",
                    config.accent,
                  )}
                >
                  <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5", config.iconClass)} />
                </div>

                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground sm:text-xs">
                    {t("processing.currentlyRunning")}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold leading-tight sm:text-xl">{config.label}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {customMessage || stageDescriptions[normalizedStage]}
                  </p>
                  {isDiarizing && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-1.5 text-xs text-lime-600 dark:text-lime-400"
                    >
                      {t("processing.matchingSpeakers")}
                    </motion.p>
                  )}
                </div>
              </div>
            </motion.div>

            <div className="rounded-2xl border border-border/60 bg-card/80 p-4 sm:p-5 lg:p-6">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
                {t("processing.elapsedTime")}
              </p>
              <div className="mt-3 flex items-start gap-2.5 sm:items-center sm:gap-3">
                <div className="flex flex-col">
                  <div className="flex items-baseline gap-0.5 text-3xl font-semibold leading-none tabular-nums sm:gap-1 sm:text-4xl lg:text-5xl">
                    <span className="tracking-[0.04em] sm:tracking-[0.08em]">
                      {String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}
                    </span>
                    <span className="text-lg text-muted-foreground sm:text-2xl lg:text-3xl">:</span>
                    <motion.span
                      key={elapsedSeconds % 60}
                      initial={{ opacity: 0.6, y: 0 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.1 }}
                      className="tracking-[0.04em] sm:tracking-[0.08em]"
                    >
                      {String(elapsedSeconds % 60).padStart(2, "0")}
                    </motion.span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border/60 bg-card p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{ t("processing.progress")}</p>
                <p className="mt-2 text-lg font-semibold">
                  {`${t("processing.stepOf")} ${currentStep} ${t("common.of")} ${stages.length}`}
                </p>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t("processing.settingsLabel")}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="max-w-full truncate rounded-full border border-border/70 px-2.5 py-1">
                    {`${t("processing.model")}: ${task.options.model}`}
                  </span>
                  <span className="rounded-full border border-border/70 px-2.5 py-1">
                    {`${t("processing.device")}: ${getDeviceLabel(task.options.device)}`}
                  </span>
                  <span className="rounded-full border border-border/70 px-2.5 py-1">
                    {`${t("queued.language")}: ${task.options.language}`}
                  </span>
                </div>
              </div>
            </div>

            {streamingSegments.length > 0 && (
              <div className="rounded-2xl border border-border/60 bg-card p-4">
                <p className="mb-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">{t("processing.liveTranscript")}</p>
                <div className="max-h-32 space-y-2 overflow-y-auto pr-1 sm:max-h-36">
                  {streamingSegments.slice(-4).map((segment) => (
                    <div key={`${segment.start}-${segment.end}-${segment.text}`} className="text-xs">
                      <span className="font-mono text-muted-foreground">{formatTime(segment.start)}</span>
                      <span className="ml-2 text-foreground/90">{segment.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
