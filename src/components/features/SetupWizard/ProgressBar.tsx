import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Props for ProgressBar component
 */
export interface ProgressBarProps {
  /** Current step index (0-based) */
  currentStepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** Names of each step for display */
  stepNames: string[];
}

/**
 * Progress bar component for Setup Wizard
 * Shows step indicators with names and completion status
 */
export function ProgressBar({
  currentStepIndex,
  totalSteps,
  stepNames,
}: ProgressBarProps) {
  return (
    <div className="w-full" role="progressbar" aria-valuenow={currentStepIndex + 1} aria-valuemin={1} aria-valuemax={totalSteps}>
      {/* Step indicators */}
      <div className="flex items-center justify-between relative">
        {/* Background line */}
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-muted -z-10" />
        
        {/* Active line */}
        <motion.div 
          className="absolute top-5 left-0 h-0.5 bg-primary -z-10"
          initial={{ width: "0%" }}
          animate={{ width: `${(currentStepIndex / (totalSteps - 1)) * 100}%` }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        />

        {Array.from({ length: totalSteps }).map((_, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          const isPending = index > currentStepIndex;

          return (
            <div key={stepNames[index] || index} className="flex flex-col items-center relative z-10">
              {/* Step circle */}
              <motion.div
                initial={false}
                animate={{
                  backgroundColor: isCompleted || isCurrent ? "var(--color-primary)" : "var(--color-background)",
                  borderColor: isCompleted || isCurrent ? "var(--color-primary)" : "var(--color-border)",
                  color: isCompleted || isCurrent ? "var(--color-primary-foreground)" : "var(--color-muted-foreground)",
                  scale: isCurrent ? 1.1 : 1,
                }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
                  isCompleted && "border-primary bg-primary text-primary-foreground",
                  isCurrent && "border-primary bg-primary text-primary-foreground shadow-sm",
                  isPending && "border-muted bg-background text-muted-foreground"
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isCompleted ? (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <Check className="h-5 w-5" aria-hidden="true" />
                  </motion.div>
                ) : (
                  <span className="text-sm font-medium">{index + 1}</span>
                )}
              </motion.div>
              {/* Step name */}
              <span
                className={cn(
                  "mt-2 text-xs font-medium text-center max-w-24 transition-colors duration-200",
                  isCurrent && "text-foreground font-semibold",
                  isCompleted && "text-foreground",
                  isPending && "text-muted-foreground"
                )}
              >
                {stepNames[index]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Screen reader text */}
      <div className="sr-only">
        Step {currentStepIndex + 1} of {totalSteps}: {stepNames[currentStepIndex]}
      </div>
    </div>
  );
}
