import { motion, useReducedMotion } from "framer-motion";
import { Check, Circle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ProgressStage } from "@/types";

const stages: { key: ProgressStage; label: string }[] = [
  { key: "loading", label: "Load" },
  { key: "transcribing", label: "Transcribe" },
  { key: "diarizing", label: "Diarize" },
  { key: "finalizing", label: "Finalize" },
];

interface StageBadgesProps {
  currentStage: ProgressStage;
  enableDiarization: boolean;
  compact?: boolean;
}

export function StageBadges({ currentStage, enableDiarization, compact }: StageBadgesProps) {
  const shouldReduceMotion = useReducedMotion();
  const normalizedStage = currentStage === "downloading" ? "loading" : currentStage;
  const filteredStages = enableDiarization
    ? stages
    : stages.filter((stage) => stage.key !== "diarizing");

  const currentIndex = filteredStages.findIndex((stage) => stage.key === normalizedStage);

  return (
    <div className="flex items-center gap-1.5">
      {filteredStages.map((stage, idx) => {
        const isCompleted = idx < currentIndex;
        const isCurrent = idx === currentIndex;
        const isPending = idx > currentIndex;

        return (
          <motion.div
            key={stage.key}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-all",
              isCompleted && "bg-emerald-500/15 text-emerald-400",
              isCurrent && "bg-primary/10 text-primary",
              isPending && "bg-muted text-muted-foreground"
            )}
            initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: shouldReduceMotion ? 0 : idx * 0.08 }}
          >
            {isCompleted && <Check className="h-3 w-3" />}
            {isCurrent && <Loader2 className="h-3 w-3 animate-spin" />}
            {isPending && <Circle className="h-3 w-3" />}
            {!compact && <span>{stage.label}</span>}
          </motion.div>
        );
      })}
    </div>
  );
}
