import { motion, useReducedMotion } from "framer-motion";
import { Clock, Cpu, MemoryStick, Zap } from "lucide-react";

import { useI18n } from "@/hooks";
import { cn, formatTime } from "@/lib/utils";
import type { ProgressMetrics } from "@/types";

interface ProgressMetricsDisplayProps {
  metrics?: ProgressMetrics;
  compact?: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatMilliseconds(valueMs: number): string {
  if (valueMs >= 1000) {
    return `${(valueMs / 1000).toFixed(2)} s`;
  }
  return `${Math.round(valueMs)} ms`;
}

export function ProgressMetricsDisplay({ metrics, compact }: ProgressMetricsDisplayProps) {
  const shouldReduceMotion = useReducedMotion();
  const { t } = useI18n();

  if (!metrics) return null;

  const items = [
    isFiniteNumber(metrics.estimatedTimeRemaining) && metrics.estimatedTimeRemaining >= 0 && {
      icon: Clock,
      label: t("progressMetrics.eta"),
      value: formatTime(metrics.estimatedTimeRemaining),
      color: "text-blue-400",
    },
    isFiniteNumber(metrics.realtimeFactor) && {
      icon: Zap,
      label: t("progressMetrics.speed"),
      value: `${metrics.realtimeFactor.toFixed(1)}x`,
      color: "text-emerald-400",
    },
    isFiniteNumber(metrics.processedDuration) && isFiniteNumber(metrics.totalDuration) && {
      icon: Clock,
      label: t("progressMetrics.progress"),
      value: `${formatTime(metrics.processedDuration)} / ${formatTime(metrics.totalDuration)}`,
      color: "text-purple-400",
    },
    isFiniteNumber(metrics.gpuUsage) && {
      icon: Cpu,
      label: t("progressMetrics.gpu"),
      value: `${metrics.gpuUsage}%`,
      color: "text-orange-400",
    },
    isFiniteNumber(metrics.cpuUsage) && {
      icon: Cpu,
      label: t("progressMetrics.cpu"),
      value: `${metrics.cpuUsage}%`,
      color: "text-sky-400",
    },
    isFiniteNumber(metrics.memoryUsage) && {
      icon: MemoryStick,
      label: t("progressMetrics.ram"),
      value: `${metrics.memoryUsage} MB`,
      color: "text-amber-400",
    },
    isFiniteNumber(metrics.modelLoadMs) && {
      icon: Clock,
      label: t("progressMetrics.load"),
      value: formatMilliseconds(metrics.modelLoadMs),
      color: "text-cyan-400",
    },
    isFiniteNumber(metrics.decodeMs) && {
      icon: Clock,
      label: t("progressMetrics.decode"),
      value: formatMilliseconds(metrics.decodeMs),
      color: "text-indigo-400",
    },
    isFiniteNumber(metrics.inferenceMs) && {
      icon: Clock,
      label: t("progressMetrics.infer"),
      value: formatMilliseconds(metrics.inferenceMs),
      color: "text-violet-400",
    },
    isFiniteNumber(metrics.diarizationMs) && {
      icon: Clock,
      label: t("progressMetrics.diarize"),
      value: formatMilliseconds(metrics.diarizationMs),
      color: "text-lime-400",
    },
    isFiniteNumber(metrics.totalMs) && {
      icon: Clock,
      label: t("progressMetrics.total"),
      value: formatMilliseconds(metrics.totalMs),
      color: "text-rose-400",
    },
  ].filter(Boolean);

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {items.map((item, idx) =>
          item ? (
            <motion.span
              key={`${item.label}-${idx}`}
              className="flex items-center gap-1"
              initial={shouldReduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: shouldReduceMotion ? 0 : idx * 0.06 }}
            >
              <item.icon className={cn("h-3 w-3", item.color)} />
              {item.value}
            </motion.span>
          ) : null
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      {items.map((item, idx) =>
        item ? (
          <motion.div
            key={`${item.label}-${idx}`}
            className="flex items-center gap-2"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: shouldReduceMotion ? 0 : idx * 0.08 }}
          >
            <item.icon className={cn("h-4 w-4", item.color)} />
            <div>
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="font-medium">{item.value}</div>
            </div>
          </motion.div>
        ) : null
      )}
    </div>
  );
}
