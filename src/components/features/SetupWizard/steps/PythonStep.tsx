import { useEffect, useState, useCallback } from "react";
import { Download, X, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckCard, CheckItem } from "../CheckCard";
import { useSetupStore } from "@/stores/setupStore";
import { 
  installPythonFull, 
  onPythonInstallProgress, 
  cancelPythonInstall,
  type InstallProgress 
} from "@/services/tauri/setup-commands";

export function PythonStep() {
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
  const pytorchStatus = pythonCheck?.pytorchInstalled ? "ok" : pythonCheck ? "error" : "pending";
  const venvStatus = pythonCheck?.inVenv ? "ok" : pythonCheck ? "warning" : "pending";

  const needsInstall = pythonCheck?.status === "error" || !pythonCheck?.version;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Python Environment</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Checking Python and required dependencies
        </p>
      </div>

      {isInstalling || installProgress ? (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">Installing Python</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>{installProgress?.message || "Preparing..."}</span>
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
              <span>Python successfully installed!</span>
            </div>
          )}
        </div>
      ) : (
        <CheckCard
          title="Python Environment"
          status={pythonCheck?.status ?? "pending"}
          message={pythonCheck?.message ?? "Checking Python..."}
          onRetry={checkPython}
        >
          {pythonCheck && (
            <div className="space-y-1">
              <CheckItem
                label={`Python ${pythonCheck.version ?? "not found"}`}
                sublabel={pythonCheck.executable ?? undefined}
                status={pythonStatus}
              />

              <CheckItem
                label={
                  pythonCheck.pytorchInstalled
                    ? `PyTorch ${pythonCheck.pytorchVersion ?? "installed"}`
                    : "PyTorch not installed"
                }
                sublabel={
                  pythonCheck.pytorchInstalled
                    ? `${pythonCheck.cudaAvailable ? "CUDA" : ""} ${pythonCheck.mpsAvailable ? "MPS" : ""} ${!pythonCheck.cudaAvailable && !pythonCheck.mpsAvailable ? "CPU only" : ""}`.trim()
                    : undefined
                }
                status={pytorchStatus}
              />

              <CheckItem
                label="Virtual Environment"
                sublabel={pythonCheck.inVenv ? "Activated" : "Not detected (recommended)"}
                status={venvStatus}
              />
            </div>
          )}
        </CheckCard>
      )}

      {needsInstall && !isInstalling && !installProgress && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
          <h4 className="font-medium text-red-600 dark:text-red-400">
            Installation required
          </h4>
          <p className="text-sm text-muted-foreground">
            The application will install Python and all required dependencies automatically.
          </p>
          <Button onClick={handleInstall} className="w-full">
            <Download className="h-4 w-4 mr-2" />
            Install Python
          </Button>
        </div>
      )}

      {installError && !isInstalling && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRetry} className="flex-1">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
      )}

      {isChecking && !pythonCheck && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-pulse text-muted-foreground">
            Checking Python environment...
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
  const { pythonCheck, checkPython, isChecking } = useSetupStore();
  
  const canProceed = pythonCheck?.status === "ok";
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
            Retry
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onNext} disabled={!canProceed || isChecking}>
          Continue
        </Button>
      </div>
    </div>
  );
}
