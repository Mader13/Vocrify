import { useEffect } from "react";
import { Box } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckCard } from "../CheckCard";
import { useSetupStore } from "@/stores/setupStore";
import type { LocalModel } from "@/types";

/**
 * Format model size for display
 */
function formatModelSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/**
 * Model card component
 */
interface ModelCardProps {
  model: LocalModel;
}

function ModelCard({ model }: ModelCardProps) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/50">
      <div className="flex-shrink-0 p-2 rounded-lg bg-primary/10 text-primary">
        <Box className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <h5 className="text-sm font-medium truncate">{model.name}</h5>
        <p className="text-xs text-muted-foreground">
          {model.modelType.toUpperCase()}
          {model.sizeMb && ` • ${formatModelSize(model.sizeMb * 1024 * 1024)}`}
        </p>
      </div>
    </div>
  );
}

/**
 * Step 4: AI Models Check
 * Verifies at least one AI model is installed
 */
export function ModelStep() {
  const { modelCheck, checkModel, isChecking } = useSetupStore();

  // Run check on mount
  useEffect(() => {
    if (!modelCheck) {
      checkModel();
    }
  }, [modelCheck, checkModel]);

  const hasModels = modelCheck && modelCheck.installedModels.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">AI Модели</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Проверка установленных моделей для транскрипции
        </p>
      </div>

      {/* Main check card */}
      <CheckCard
        title="AI Модели"
        status={modelCheck?.status ?? "pending"}
        message={modelCheck?.message ?? "Проверка моделей..."}
        onRetry={checkModel}
      />

      {/* Installed models list */}
      {hasModels && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            Установлено моделей: {modelCheck.installedModels.length}
          </h4>
          <div className="grid gap-2">
            {modelCheck.installedModels.map((model, index) => (
              <ModelCard key={`${model.name}-${index}`} model={model} />
            ))}
          </div>
        </div>
      )}

      {/* No models warning */}
      {modelCheck && !hasModels && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 space-y-3">
          <h4 className="font-medium text-yellow-600 dark:text-yellow-400">
            Модели не найдены
          </h4>
          <p className="text-sm text-muted-foreground">
            Для транскрипции необходимо установить хотя бы одну модель Whisper или Parakeet.
          </p>
          <div className="text-sm space-y-2">
            <p className="font-medium text-foreground">Рекомендуемые модели:</p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-muted-foreground">
              <li>
                <span className="font-medium">whisper-base</span> — быстрая, для простых задач (~74 MB)
              </li>
              <li>
                <span className="font-medium">whisper-small</span> — сбалансированная (~244 MB)
              </li>
              <li>
                <span className="font-medium">whisper-medium</span> — качественная (~769 MB)
              </li>
              <li>
                <span className="font-medium">whisper-large-v3</span> — лучшее качество (~1.5 GB)
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Info about models */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <h4 className="text-sm font-medium mb-2">О моделях</h4>
        <p className="text-xs text-muted-foreground">
          Модели Whisper от OpenAI обеспечивают высокое качество транскрипции.
          Модели Parakeet от NVIDIA оптимизированы для реального времени.
          Модели загружаются автоматически при первом использовании или через настройки приложения.
        </p>
      </div>

      {/* Loading state */}
      {isChecking && !modelCheck && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-pulse text-muted-foreground">
            Проверка моделей...
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Footer actions for Model step
 */
export interface ModelStepFooterProps {
  onBack: () => void;
  onNext: () => void;
}

export function ModelStepFooter({ onBack, onNext }: ModelStepFooterProps) {
  const { modelCheck, checkModel, isChecking } = useSetupStore();
  
  const hasModels = modelCheck && modelCheck.installedModels.length > 0;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          Назад
        </Button>
        {modelCheck?.status === "error" && (
          <Button
            variant="outline"
            onClick={() => checkModel()}
            disabled={isChecking}
          >
            Повторить
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onNext} disabled={isChecking}>
          {hasModels ? "Продолжить" : "Пропустить"}
        </Button>
      </div>
    </div>
  );
}
