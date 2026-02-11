import * as React from "react";
import { useEffect } from "react";
import { Rocket, X } from "lucide-react";
import { ProgressBar } from "./ProgressBar";
import { PythonStep, PythonStepFooter } from "./steps/PythonStep";
import { FFmpegStep, FFmpegStepFooter } from "./steps/FFmpegStep";
import { DeviceStep, DeviceStepFooter } from "./steps/DeviceStep";

import { OptionalStep, OptionalStepFooter } from "./steps/OptionalStep";
import { useSetupStore } from "@/stores/setupStore";
import { cn } from "@/lib/utils";
import type { SetupStep } from "@/types/setup";

/**
 * Step names for progress bar
 */
const STEP_NAMES: string[] = [
  "Python",
  "FFmpeg",
  "Устройства",
  "Опции",
];

/**
 * Step order for navigation
 */
const STEPS: SetupStep[] = ["python", "ffmpeg", "device", "optional"];

/**
 * Props for SetupWizard component
 */
export interface SetupWizardProps {
  /** Callback when setup is completed */
  onComplete?: () => void;
  /** Callback when setup is skipped/cancelled */
  onSkip?: () => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Main Setup Wizard component
 * Guides users through first-launch setup process
 */
export function SetupWizard({ onComplete, onSkip, className }: SetupWizardProps) {
  const {
    currentStep,
    isComplete,
    checkAll,
    nextStep,
    prevStep,
    completeSetup,
    skipSetup,
  } = useSetupStore();

  // Run checks on mount - run only once
  useEffect(() => {
    checkAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle setup completion
  useEffect(() => {
    if (isComplete) {
      onComplete?.();
    }
  }, [isComplete, onComplete]);

  // Get current step index
  const currentStepIndex = STEPS.indexOf(currentStep);

  // Handle next button
  const handleNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      nextStep();
    }
  };

  // Handle back button
  const handleBack = () => {
    if (currentStepIndex > 0) {
      prevStep();
    }
  };

  // Handle complete setup
  const handleComplete = async () => {
    await completeSetup();
  };

  // Handle skip
  const handleSkip = () => {
    skipSetup();
    onSkip?.();
  };

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case "python":
        return <PythonStep />;
      case "ffmpeg":
        return <FFmpegStep />;
      case "device":
        return <DeviceStep />;
      case "optional":
        return <OptionalStep />;
      default:
        return null;
    }
  };

  // Render current step footer
  const renderStepFooter = () => {
    switch (currentStep) {
      case "python":
        return (
          <PythonStepFooter
            onSkip={handleSkip}
            onNext={handleNext}
          />
        );
      case "ffmpeg":
        return (
          <FFmpegStepFooter
            onBack={handleBack}
            onNext={handleNext}
          />
        );
      case "device":
        return (
          <DeviceStepFooter
            onBack={handleBack}
            onNext={handleNext}
          />
        );
      case "optional":
        return (
          <OptionalStepFooter
            onBack={handleBack}
            onComplete={handleComplete}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col min-h-[500px] max-w-2xl mx-auto",
        "bg-background rounded-xl shadow-lg border",
        className
      )}
      role="dialog"
      aria-labelledby="setup-wizard-title"
      aria-modal="true"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Rocket className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 id="setup-wizard-title" className="text-lg font-semibold">
              Первичная настройка
            </h1>
            <p className="text-sm text-muted-foreground">
              Шаг {currentStepIndex + 1} из {STEPS.length}
            </p>
          </div>
        </div>
        {onSkip && (
          <button
            onClick={handleSkip}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Пропустить настройку"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-6 py-4 border-b bg-muted/30">
        <ProgressBar
          currentStepIndex={currentStepIndex}
          totalSteps={STEPS.length}
          stepNames={STEP_NAMES}
        />
      </div>

      {/* Step content */}
      <div className="flex-1 px-6 py-6 overflow-y-auto">
        {renderStepContent()}
      </div>

      {/* Footer with navigation */}
      <div className="px-6 py-4 border-t bg-muted/30">
        {renderStepFooter()}
      </div>
    </div>
  );
}

/**
 * Wrapper component that conditionally renders SetupWizard
 * based on whether setup has been completed
 */
export interface SetupWizardGuardProps extends SetupWizardProps {
  /** Content to show when setup is complete */
  children: React.ReactNode;
}

export function SetupWizardGuard({ children, ...wizardProps }: SetupWizardGuardProps) {
  const { isComplete } = useSetupStore();

  // Show wizard if setup is not complete
  if (!isComplete) {
    return <SetupWizard {...wizardProps} />;
  }

  // Show main content if setup is complete
  return <>{children}</>;
}

export default SetupWizard;
