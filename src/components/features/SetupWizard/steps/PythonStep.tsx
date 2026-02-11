import { useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckCard, CheckItem } from "../CheckCard";
import { useSetupStore } from "@/stores/setupStore";

/**
 * Step 1: Python Environment Check
 * Verifies Python version, PyTorch installation, and GPU support
 */
export function PythonStep() {
  const { pythonCheck, checkPython, isChecking } = useSetupStore();

  // Run check on mount
  useEffect(() => {
    if (!pythonCheck) {
      checkPython();
    }
  }, [pythonCheck, checkPython]);

  // Determine individual check statuses
  const pythonStatus = pythonCheck?.version ? "ok" : pythonCheck ? "error" : "pending";
  const pytorchStatus = pythonCheck?.pytorchInstalled
    ? "ok"
    : pythonCheck
      ? "error"
      : "pending";
  const venvStatus = pythonCheck?.inVenv
    ? "ok"
    : pythonCheck
      ? "warning"
      : "pending";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Python Environment</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Проверка Python и необходимых зависимостей
        </p>
      </div>

      {/* Main check card */}
      <CheckCard
        title="Окружение Python"
        status={pythonCheck?.status ?? "pending"}
        message={pythonCheck?.message ?? "Проверка Python..."}
        onRetry={checkPython}
      >
        {pythonCheck && (
          <div className="space-y-1">
            {/* Python version */}
            <CheckItem
              label={`Python ${pythonCheck.version ?? "не найден"}`}
              sublabel={pythonCheck.executable ?? undefined}
              status={pythonStatus}
            />

            {/* PyTorch */}
            <CheckItem
              label={
                pythonCheck.pytorchInstalled
                  ? `PyTorch ${pythonCheck.pytorchVersion ?? "установлен"}`
                  : "PyTorch не установлен"
              }
              sublabel={
                pythonCheck.pytorchInstalled
                  ? `${pythonCheck.cudaAvailable ? "CUDA" : ""} ${pythonCheck.mpsAvailable ? "MPS" : ""} ${!pythonCheck.cudaAvailable && !pythonCheck.mpsAvailable ? "CPU only" : ""}`.trim()
                  : undefined
              }
              status={pytorchStatus}
            />

            {/* Virtual environment (optional) */}
            <CheckItem
              label="Virtual Environment"
              sublabel={pythonCheck.inVenv ? "Активировано" : "Не обнаружено (рекомендуется)"}
              status={venvStatus}
            />
          </div>
        )}
      </CheckCard>

      {/* Installation instructions for errors */}
      {pythonCheck?.status === "error" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
          <h4 className="font-medium text-red-600 dark:text-red-400">
            Требуется установка
          </h4>
          <div className="text-sm space-y-2 text-muted-foreground">
            <p>Для работы приложения необходим Python 3.10 или 3.12:</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>
                Установите Python{" "}
                <a
                  href="https://www.python.org/downloads/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  python.org/downloads
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>Установите PyTorch с поддержкой GPU:</li>
            </ol>
            <div className="bg-muted rounded-md p-3 font-mono text-xs overflow-x-auto mt-2">
              <code>
                pip install torch torchvision torchaudio --extra-index-url
                https://download.pytorch.org/whl/cu121
              </code>
            </div>
            <p className="text-xs">
              Для macOS с Apple Silicon используйте стандартную установку без extra-index-url
            </p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {isChecking && !pythonCheck && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-pulse text-muted-foreground">
            Проверка Python environment...
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Footer actions for Python step
 */
export interface PythonStepFooterProps {
  onSkip?: () => void;
  onNext: () => void;
}

export function PythonStepFooter({ onSkip, onNext }: PythonStepFooterProps) {
  const { pythonCheck, checkPython, isChecking } = useSetupStore();
  
  const canProceed = pythonCheck?.status === "ok" || pythonCheck?.status === "warning";
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
            Повторить
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Пропустить
          </Button>
        )}
        <Button onClick={onNext} disabled={!canProceed || isChecking}>
          Продолжить
        </Button>
      </div>
    </div>
  );
}
