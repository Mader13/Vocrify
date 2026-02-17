import * as React from "react";
import { Check } from "lucide-react";
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
      <div className="flex items-center justify-between">
        {Array.from({ length: totalSteps }).map((_, index) => {
          const isCompleted = index < currentStepIndex;
          const isCurrent = index === currentStepIndex;
          const isPending = index > currentStepIndex;

          return (
            <React.Fragment key={stepNames[index] || index}>
              {/* Step circle */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
                    isCompleted && "border-green-500 bg-green-500 text-white",
                    isCurrent && "border-primary bg-primary text-primary-foreground",
                    isPending && "border-muted bg-muted text-muted-foreground"
                  )}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <span className="text-sm font-medium">{index + 1}</span>
                  )}
                </div>
                {/* Step name */}
                <span
                  className={cn(
                    "mt-2 text-xs font-medium text-center max-w-[80px]",
                    isCurrent && "text-primary",
                    isCompleted && "text-green-600 dark:text-green-400",
                    isPending && "text-muted-foreground"
                  )}
                >
                  {stepNames[index]}
                </span>
              </div>

              {/* Connector line */}
              {index < totalSteps - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2 mt-[-20px] transition-colors",
                    index < currentStepIndex
                      ? "bg-green-500"
                      : "bg-muted"
                  )}
                  aria-hidden="true"
                />
              )}
            </React.Fragment>
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
