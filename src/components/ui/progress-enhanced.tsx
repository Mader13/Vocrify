import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";
import type { ProgressStage } from "@/types";

interface ProgressEnhancedProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
  stage: ProgressStage;
}

const stageColors: Record<ProgressStage, string> = {
  loading: "bg-blue-500",
  downloading: "bg-blue-400",
  transcribing: "bg-green-500",
  diarizing: "bg-purple-500",
  finalizing: "bg-emerald-500",
  ready: "bg-muted-foreground",
};

export function ProgressEnhanced({ value, stage, className, ...props }: ProgressEnhancedProps) {
  const shouldReduceMotion = useReducedMotion();
  const width = Math.min(Math.max(value, 0), 100);

  return (
    <div
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-secondary", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
      {...props}
    >
      <motion.div
        className={cn(
          "h-full",
          stageColors[stage],
          !shouldReduceMotion && "progress-stripes"
        )}
        initial={false}
        animate={{ width: `${width}%` }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.5, ease: "easeOut" }}
      />
    </div>
  );
}
