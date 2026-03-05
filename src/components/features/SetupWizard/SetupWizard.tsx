import * as React from "react";
import { useEffect, useMemo } from "react";
import { Rocket, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { ProgressBar } from "./ProgressBar";
import { LanguageStep, LanguageStepFooter } from "./steps/LanguageStep";
import { StorageStep, StorageStepFooter } from "./steps/StorageStep";
import { FFmpegStep, FFmpegStepFooter } from "./steps/FFmpegStep";
import { DeviceStep, DeviceStepFooter } from "./steps/DeviceStep";
import { ModelStep, ModelStepFooter } from "./steps/ModelStep";
import { SummaryStep, SummaryStepFooter } from "./steps/SummaryStep";
import { useSetupStore } from "@/stores/setupStore";
import { useI18n } from "@/hooks";
import { cn } from "@/lib/utils";
import type { I18nKey } from "@/i18n";
import type { SetupStep } from "@/types/setup";

/**
 * Step order for navigation
 */
const STEPS: SetupStep[] = ["language", "storage", "ffmpeg", "device", "model", "summary"];

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
  const { t } = useI18n();
  const {
    currentStep,
    error,
    ffmpegCheck,
    deviceCheck,
    modelCheck,
    checkAll,
    fetchDevices,
    nextStep,
    prevStep,
    completeSetup,
    skipSetup,
  } = useSetupStore();

  // Run checks on mount, and fetch devices on-demand
  useEffect(() => {
    if (!ffmpegCheck || !modelCheck) {
      void checkAll();
    }

    if (!deviceCheck) {
      void fetchDevices(false);
    }
  }, [ffmpegCheck, modelCheck, deviceCheck, checkAll, fetchDevices]);

  const stepNames = useMemo(() => {
    const stepNameKeys: readonly I18nKey[] = [
      "settings.language",
      "setup.storage",
      "setup.ffmpeg",
      "setup.devices",
      "setup.modelsStep",
      "setup.start",
    ];
    return stepNameKeys.map((key) => t(key));
  }, [t]);


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
    if (useSetupStore.getState().isComplete) {
      onComplete?.();
    }
  };

  // Handle skip
  const handleSkip = () => {
    skipSetup();
    if (!useSetupStore.getState().error) {
      onSkip?.();
    }
  };

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case "language":
        return <LanguageStep />;
      case "storage":
        return <StorageStep />;
      case "ffmpeg":
        return <FFmpegStep />;
      case "device":
        return <DeviceStep />;
      case "model":
        return <ModelStep />;
      case "summary":
        return <SummaryStep />;
      default:
        return null;
    }
  };

  // Render current step footer
  const renderStepFooter = () => {
    switch (currentStep) {
      case "language":
        return (
          <LanguageStepFooter
            onNext={handleNext}
          />
        );
      case "storage":
        return (
          <StorageStepFooter
            onBack={handleBack}
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
      case "model":
        return (
          <ModelStepFooter
            onBack={handleBack}
            onNext={handleNext}
          />
        );
      case "summary":
        return (
          <SummaryStepFooter
            onBack={handleBack}
            onComplete={handleComplete}
          />
        );
      default:
        return null;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn(
        "flex flex-col min-h-125 max-w-2xl mx-auto",
        "bg-background rounded-xl shadow-2xl border border-border/50 overflow-hidden",
        className
      )}
      role="dialog"
      aria-labelledby="setup-wizard-title"
      aria-modal="true"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary shadow-sm">
            <Rocket className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h1 id="setup-wizard-title" className="text-xl font-bold tracking-tight">
              {t("setup.initialSetup")}
            </h1>
            <p className="text-sm text-muted-foreground font-medium">
              {t("setup.stepOf")} {currentStepIndex + 1} {t("common.of")} {STEPS.length}
            </p>
          </div>
        </div>
        {onSkip && (
          <button
            onClick={handleSkip}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={t("setup.skipSetup")}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-8 py-5 border-b bg-muted/20">
        <ProgressBar
          currentStepIndex={currentStepIndex}
          totalSteps={STEPS.length}
          stepNames={stepNames}
        />
      </div>

      {/* Step content */}
      <div className="flex-1 px-8 py-8 overflow-y-auto overflow-x-hidden relative bg-card/30">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="h-full"
          >
            {renderStepContent()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer with navigation */}
      <div className="px-8 py-5 border-t bg-card/50 backdrop-blur-sm">
        {renderStepFooter()}
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 text-sm text-destructive font-medium bg-destructive/10 p-3 rounded-lg border border-destructive/20"
          >
            {error}
          </motion.p>
        )}
      </div>
    </motion.div>
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
  const isComplete = useSetupStore((state) => state.isComplete);

  if (isComplete) {
    return <>{children}</>;
  }

  return <SetupWizard {...wizardProps} />;
}

export default SetupWizard;
