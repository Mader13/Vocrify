import { useEffect, useState, useCallback } from "react";
import { Download, X, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckCard, CheckItem } from "../CheckCard";
import { useSetupStore } from "@/stores/setupStore";
import { useI18n } from "@/hooks";
import { 
  installPythonFull, 
  onPythonInstallProgress, 
  cancelPythonInstall,
  type InstallProgress 
} from "@/services/tauri/setup-commands";

export function PythonStep() {
  const { t } = useI18n();
  const { pythonCheck, checkPython, isChecking } = useSetupStore();
  
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    if (!pythonCheck) {
      checkPython();
    }
  }, [pythonCheck, checkPython]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    const setupListener = async () => {
      unlisten = await onPythonInstallProgress((progress) => {
        setInstallProgress(progress);
        if (progress.stage === "complete") {
          setIsInstalling(false);
          setInstallError(null);
          void (async () => {
            await checkPython();
            setInstallProgress(null);
          })();
        } else if (progress.stage === "error") {
          setIsInstalling(false);
          setInstallError(progress.error || "Unknown error");
          setInstallProgress(null);
        }
      });
    };
    
    setupListener();
    
    return () => {
      if (unlisten) unlisten();
    };
  }, [checkPython]);

  const handleInstall = useCallback(async () => {
    setIsInstalling(true);
    setInstallError(null);
    setInstallProgress(null);
    
    const result = await installPythonFull();
    if (!result.success) {
      setIsInstalling(false);
      setInstallError(result.error || "Installation failed");
    }
  }, []);

  const handleCancel = useCallback(async () => {
    await cancelPythonInstall();
    setIsInstalling(false);
    setInstallProgress(null);
  }, []);

  const handleRetry = useCallback(() => {
    setInstallError(null);
    handleInstall();
  }, [handleInstall]);

  const pythonStatus = pythonCheck?.version ? "ok" : pythonCheck ? "error" : "pending";
  const venvStatus = pythonCheck?.inVenv ? "ok" : pythonCheck ? "warning" : "pending";

  const needsInstall = pythonCheck?.status === "error" || !pythonCheck?.version;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t("setup.pythonTitle")}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t("setup.pythonDesc")}
        </p>
      </div>

      {isInstalling || installProgress ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">{t("setup.installingPython")}</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4 mr-1" />
              {t("common.cancel")}
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{installProgress?.message || t("setup.preparing")}</span>
              <span>{Math.round(installProgress?.percent || 0)}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${installProgress?.percent || 0}%` }}
              />
            </div>
          </div>

          {installError && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>{installError}</span>
            </div>
          )}

          {installProgress?.stage === "complete" && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <CheckCircle className="h-4 w-4" />
              <span>{t("setup.pythonInstalled")}</span>
            </div>
          )}
        </div>
      ) : (
        <CheckCard
          title={t("setup.pythonTitle")}
          status={pythonCheck?.status ?? "pending"}
          message={pythonCheck?.message ?? t("setup.checkingPython")}
          onRetry={checkPython}
        >
          {pythonCheck && (
            <div className="space-y-1">
              <CheckItem
                label={`Python ${pythonCheck.version ?? t("setup.notFound")}`}
                sublabel={pythonCheck.executable ?? undefined}
                status={pythonStatus}
              />

              <CheckItem
                label={t("setup.virtualEnv")}
                sublabel={pythonCheck.inVenv ? t("setup.activated") : t("setup.notDetected")}
                status={venvStatus}
              />
            </div>
          )}
        </CheckCard>
      )}

      {needsInstall && !isInstalling && !installProgress && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
          <h4 className="font-medium text-red-700 dark:text-red-400">
            {t("setup.installRequired")}
          </h4>
          <p className="text-sm text-muted-foreground">
            {t("setup.installRequiredDesc")}
          </p>
          <Button onClick={handleInstall} className="w-full">
            <Download className="h-4 w-4 mr-2" />
            {t("setup.installPython")}
          </Button>
        </div>
      )}

      {installError && !isInstalling && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRetry} className="flex-1">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t("common.retry")}
          </Button>
        </div>
      )}

      {isChecking && !pythonCheck && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-pulse text-muted-foreground">
            {t("setup.checkingPythonEnv")}
          </div>
        </div>
      )}
    </div>
  );
}

export interface PythonStepFooterProps {
  onNext: () => void;
}

export function PythonStepFooter({ onNext }: PythonStepFooterProps) {
  const { t } = useI18n();
  const { pythonCheck, checkPython, isChecking } = useSetupStore();
  
  // Python is optional for transcription (only needed for diarization)
  // So we allow proceeding even if there's an error
  const canProceed = true;
  const hasError = pythonCheck?.status === "error";

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {hasError && (
          <Button
            variant="outline"
            onClick={() => checkPython()}
            disabled={isChecking}
          >
            {t("common.retry")}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {hasError && (
          <span className="text-xs text-muted-foreground mr-2">
            Optional (needed for speaker detection only)
          </span>
        )}
        <Button onClick={onNext} disabled={!canProceed || isChecking}>
          {hasError ? "Skip" : t("common.continue")}
        </Button>
      </div>
    </div>
  );
}
