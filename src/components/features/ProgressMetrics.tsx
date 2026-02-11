import { motion, useReducedMotion } from "framer-motion";
import { Clock, Cpu, MemoryStick, Zap } from "lucide-react";

import { cn, formatTime } from "@/lib/utils";
import type { ProgressMetrics } from "@/types";

interface ProgressMetricsDisplayProps {
  metrics?: ProgressMetrics;
  compact?: boolean;
}

export function ProgressMetricsDisplay({ metrics, compact }: ProgressMetricsDisplayProps) {
  const shouldReduceMotion = useReducedMotion();

  if (!metrics) return null;

  const items = [
    metrics.estimatedTimeRemaining !== undefined && metrics.estimatedTimeRemaining >= 0 && {
      icon: Clock,
      label: "ETA",
      value: formatTime(metrics.estimatedTimeRemaining),
      color: "text-blue-400",
    },
    metrics.realtimeFactor !== undefined && {
      icon: Zap,
      label: "Speed",
      value: `${metrics.realtimeFactor.toFixed(1)}x`,
      color: "text-emerald-400",
    },
    metrics.processedDuration !== undefined && metrics.totalDuration !== undefined && {
      icon: Clock,
      label: "Progress",
      value: `${formatTime(metrics.processedDuration)} / ${formatTime(metrics.totalDuration)}`,
      color: "text-purple-400",
    },
    metrics.gpuUsage !== undefined && {
      icon: Cpu,
      label: "GPU",
      value: `${metrics.gpuUsage}%`,
      color: "text-orange-400",
    },
    metrics.cpuUsage !== undefined && {
      icon: Cpu,
      label: "CPU",
      value: `${metrics.cpuUsage}%`,
      color: "text-sky-400",
    },
    metrics.memoryUsage !== undefined && {
      icon: MemoryStick,
      label: "RAM",
      value: `${metrics.memoryUsage} MB`,
      color: "text-amber-400",
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
