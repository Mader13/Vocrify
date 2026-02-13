import * as React from "react";
import { CheckCircle2, FolderOpen, HardDrive } from "lucide-react";
import { useModelsStore } from "@/stores/modelsStore";
import { ModelCard } from "@/components/features/ModelCard";
import { HuggingFaceTokenCard } from "@/components/features/HuggingFaceTokenCard";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { openModelsFolder } from "@/services/tauri";
import { MODEL_NAMES } from "@/types";

export function ModelsManagement() {
  const {
    availableModels,
    downloads,
    diskUsage,
    selectedTranscriptionModel,
    loadModels,
    loadDiskUsage,
    downloadModel,
    deleteModel,
    cancelModelDownload,
    setSelectedTranscriptionModel,
  } = useModelsStore();

  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await Promise.all([loadModels(), loadDiskUsage()]);
      setIsLoading(false);
    };
    init();
  }, [loadModels, loadDiskUsage]);

  const formatSize = (mb: number | undefined): string => {
    if (mb === undefined || mb === null || isNaN(mb)) {
      return "—";
    }
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb} MB`;
  };

  const formatEta = (etaS?: number): string | null => {
    if (!etaS || etaS <= 0) {
      return null;
    }
    const totalSeconds = Math.round(etaS);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}м ${seconds}с` : `${seconds}с`;
  };

  const totalDownloads = Object.values(downloads).filter(
    (d) => d.status === "downloading",
  );
  const installedModelsCount = availableModels.filter(
    (m) => m.installed,
  ).length;
  const whisperModels = availableModels.filter((m) => m.modelType === "whisper");
  const parakeetModels = availableModels.filter((m) => m.modelType === "parakeet");
  const diarizationModels = availableModels.filter((m) => m.modelType === "diarization");

  const handleOpenModelsFolder = async () => {
    const result = await openModelsFolder();
    if (!result.success) {
      console.error("Failed to open models folder:", result.error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Управление моделями</h1>
            <p className="text-muted-foreground mt-2">
              Скачайте и управляйте моделями для транскрипции
            </p>
          </div>
          <Button
            onClick={handleOpenModelsFolder}
            variant="outline"
            className="gap-2"
          >
            <FolderOpen className="h-4 w-4" />
            Открыть папку с моделями
          </Button>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-3 lg:grid-cols-4">
          {selectedTranscriptionModel && (
            <div className="rounded-xl border bg-card/80 p-4 transition-all duration-200 hover:border-primary/40 hover:shadow-sm lg:col-span-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Выбранная модель
              </p>
              <p className="mt-2 line-clamp-1 text-lg font-semibold">
                {MODEL_NAMES[selectedTranscriptionModel as keyof typeof MODEL_NAMES] ??
                  selectedTranscriptionModel}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Используется по умолчанию для новых задач транскрипции.
              </p>
            </div>
          )}

          <div className="rounded-xl border bg-card/80 p-4 transition-all duration-200 hover:-translate-y-px hover:border-blue-500/40 hover:shadow-sm flex items-center">
            <div className="flex items-center gap-3 w-full">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <HardDrive className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Занято моделями
                </p>
                <p className="text-xl font-semibold">
                  {formatSize(diskUsage?.totalSizeMb)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card/80 p-4 transition-all duration-200 hover:-translate-y-px hover:border-emerald-500/40 hover:shadow-sm flex items-center">
            <div className="flex items-center gap-3 w-full">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Скачено моделей
                </p>
                <p className="text-xl font-semibold">
                  {installedModelsCount}
                </p>
              </div>
            </div>
          </div>
        </div>

        {totalDownloads.length > 0 && (
          <div className="mb-8 p-4 rounded-xl border bg-primary/5">
            <h2 className="font-semibold mb-3">Активные загрузки</h2>
            <div className="space-y-3">
              {totalDownloads.map((download) => (
                <div key={download.modelName} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{download.modelName}</span>
                    <span>{download.progress.toFixed(0)}%</span>
                  </div>
                  <Progress value={download.progress} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    {formatSize(download.currentMb)} /{" "}
                    {formatSize(download.totalMb)}
                    {download.totalEstimated ? " (оценочно)" : ""}
                    {download.speedMbS && ` • ${download.speedMbS} MB/s`}
                    {formatEta(download.etaS) && ` • осталось ~${formatEta(download.etaS)}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-8">
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <span>🐍</span> Whisper Models
            </h2>
            <div className="space-y-3">
              {whisperModels.map((model, index) => (
                  <ModelCard
                    key={model.name}
                    model={model}
                    download={downloads[model.name]}
                    animationDelayMs={index * 45}
                    onDownload={() => downloadModel(model.name, "whisper")}
                    onDownloadCancel={() => cancelModelDownload(model.name)}
                    onDelete={() =>
                      deleteModel(model.name).then(() => loadModels())
                    }
                    onSelect={() => setSelectedTranscriptionModel(model.name)}
                    isSelected={selectedTranscriptionModel === model.name}
                  />
                ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <span>🦜</span> Parakeet Models
            </h2>
            <div className="space-y-3">
              {parakeetModels.map((model, index) => (
                  <ModelCard
                    key={model.name}
                    model={model}
                    download={downloads[model.name]}
                    animationDelayMs={100 + index * 45}
                    onDownload={() => downloadModel(model.name, "parakeet")}
                    onDownloadCancel={() => cancelModelDownload(model.name)}
                    onDelete={() =>
                      deleteModel(model.name).then(() => loadModels())
                    }
                    onSelect={() => setSelectedTranscriptionModel(model.name)}
                    isSelected={selectedTranscriptionModel === model.name}
                  />
                ))}
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <span>🎤</span> Диаризация (разделение спикеров)
            </h2>
            <div className="mb-4">
              <HuggingFaceTokenCard />
            </div>
            <div className="space-y-3">
              {diarizationModels.map((model, index) => (
                  <ModelCard
                    key={model.name}
                    model={model}
                    download={downloads[model.name]}
                    animationDelayMs={180 + index * 45}
                    onDownload={() => downloadModel(model.name, "diarization")}
                    onDownloadCancel={() => cancelModelDownload(model.name)}
                    onDelete={() =>
                      deleteModel(model.name).then(() => loadModels())
                    }
                  />
                ))}
            </div>
          </div>
        </div>

        <div className="mt-8 p-4 rounded-xl border bg-muted/50">
          <h3 className="font-medium mb-2">Примечание</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>
              • Whisper - открытая модель от OpenAI, поддерживает множество
              языков
            </li>
            <li>• Parakeet - модель от NVIDIA, оптимизирована для GPU</li>
            <li>
              • Модели загружаются в директорию приложения и доступны офлайн
            </li>
            <li>• Для работы Parakeet рекомендуется использовать GPU</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
