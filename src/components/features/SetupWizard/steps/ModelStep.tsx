import { useEffect, useState } from "react";
import { Box, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckCard } from "../CheckCard";
import { useSetupStore } from "@/stores/setupStore";
import { AVAILABLE_MODELS, type LocalModel } from "@/types";
import { useModelsStore } from "@/stores/modelsStore";
import { useI18n } from "@/hooks";

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

function getModelSizeLabel(modelName: string): string {
  const model = AVAILABLE_MODELS.find((m) => m.name === modelName);
  if (!model) return "~?";
  return formatModelSize(model.sizeMb * 1024 * 1024);
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
      <div className="shrink-0 p-2 rounded-lg bg-primary/10 text-primary">
        <Box className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <h5 className="text-sm font-medium truncate">{model.name}</h5>
        <p className="text-xs text-muted-foreground">
          {model.modelType.toUpperCase()}
          {model.sizeMb && ` | ${formatModelSize(model.sizeMb * 1024 * 1024)}`}
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
  const { t } = useI18n();
  const { modelCheck, checkModel, isChecking } = useSetupStore();
  const { downloads, downloadModel } = useModelsStore();
  const [isDownloadingBase, setIsDownloadingBase] = useState(false);

  // Run check on mount
  useEffect(() => {
    if (!modelCheck) {
      checkModel();
    }
  }, [modelCheck, checkModel]);

  // Watch for download completion to re-check models
  useEffect(() => {
    const baseDownload = downloads["whisper-base"];
    if (isDownloadingBase && baseDownload?.status === "completed") {
      setIsDownloadingBase(false);
      checkModel();
    } else if (isDownloadingBase && baseDownload?.status === "error") {
      setIsDownloadingBase(false);
    }
  }, [downloads, isDownloadingBase, checkModel]);

  const hasModels = modelCheck && modelCheck.installedModels.length > 0;
  const baseDownloadState = downloads["whisper-base"];
  const isDownloading = baseDownloadState?.status === "downloading";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t("setup.modelsTitle")}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t("setup.modelsStepDesc")}
        </p>
      </div>

      {/* Main check card */}
      <CheckCard
        title={t("setup.modelsTitle")}
        status={modelCheck?.status ?? "pending"}
        message={modelCheck?.message ?? t("setup.modelsStepCheckMessage")}
        onRetry={checkModel}
      />

      {/* Installed models list */}
      {hasModels && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-muted-foreground">
            {t("setup.modelsStepInstalled")}: {modelCheck.installedModels.length}
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
            {t("setup.modelsStepNoModels")}
          </h4>
          <p className="text-sm text-muted-foreground">
            {t("setup.modelsStepNoModelsDesc")}
          </p>
          <div className="pt-2">
            <Button 
              onClick={() => {
                setIsDownloadingBase(true);
                downloadModel("whisper-base", "whisper");
              }}
              disabled={isDownloading}
              className="w-full sm:w-auto gap-2"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("setup.downloading")}... {baseDownloadState?.progress ? `${Math.round(baseDownloadState.progress)}%` : ""}
                </>
              ) : (
                `${t("setup.modelsStepDownloadBase")} (~${getModelSizeLabel("whisper-base")})`
              )}
            </Button>
            {baseDownloadState?.status === "error" && (
              <p className="text-xs text-red-700 dark:text-red-400 mt-2">
                {t("setup.error")}: {baseDownloadState.error}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Info about models */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <h4 className="text-sm font-medium mb-2">{t("setup.aboutModels") || "About Models"}</h4>
        <p className="text-xs text-muted-foreground">
          {t("setup.aboutModelsDesc") || "Whisper models provide high-quality transcription. Models can be downloaded later through the application settings."}
        </p>
      </div>

      {/* Loading state */}
      {isChecking && !modelCheck && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-pulse text-muted-foreground">
            {t("setup.checking")}
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
  const { t } = useI18n();
  const { modelCheck, checkModel, isChecking } = useSetupStore();
  
  const hasModels = modelCheck && modelCheck.installedModels.length > 0;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          {t("common.back")}
        </Button>
        {modelCheck?.status === "error" && (
          <Button
            variant="outline"
            onClick={() => checkModel()}
            disabled={isChecking}
          >
            {t("common.retry")}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!hasModels && (
          <span className="text-xs text-muted-foreground mr-2">
            {t("setup.optional")}
          </span>
        )}
        <Button onClick={onNext} disabled={isChecking}>
          {hasModels ? t("common.continue") : t("setup.skipSetup")}
        </Button>
      </div>
    </div>
  );
}
