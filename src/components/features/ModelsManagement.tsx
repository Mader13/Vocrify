import * as React from "react";
import { FolderOpen } from "lucide-react";
import { useModelsStore } from "@/stores/modelsStore";
import { ModelCard } from "@/components/features/ModelCard";
import { TranscriptionModelDisplay } from "@/components/features/ModelDisplayCard";
import { HuggingFaceTokenCard } from "@/components/features/HuggingFaceTokenCard";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { openModelsFolder } from "@/services/tauri";

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

  const totalDownloads = Object.values(downloads).filter(
    (d) => d.status === "downloading",
  );
  const installedModelsCount = availableModels.filter(
    (m) => m.installed,
  ).length;

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
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex items-center justify-between">
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

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-8">
          {selectedTranscriptionModel && (
            <div className="lg:col-span-2">
              <TranscriptionModelDisplay
                model={selectedTranscriptionModel}
                size="large"
              />
            </div>
          )}

          <div className="relative group overflow-hidden rounded-2xl border bg-card/50 backdrop-blur-sm h-full transition-all duration-500 ease-out border-blue-500/30 hover:border-blue-500/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-blue-500/20">
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-blue-500/20 via-blue-500/5 to-transparent" />
            <div className="relative h-full flex items-center gap-4 p-5">
              <div className="relative flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/10 to-blue-500/5 text-2xl shadow-lg group-hover:scale-105 transition-all duration-500">
                💾
                <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/20 to-transparent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Занято моделями
                </p>
                <p className="text-xl font-semibold">
                  {formatSize(diskUsage?.totalSizeMb)}
                </p>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-0 group-hover:opacity-30 transition-opacity duration-500" />
          </div>

          <div className="relative group overflow-hidden rounded-2xl border bg-card/50 backdrop-blur-sm h-full transition-all duration-500 ease-out border-emerald-500/30 hover:border-emerald-500/60 hover:-translate-y-1 hover:shadow-2xl hover:shadow-emerald-500/20">
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-emerald-500/20 via-emerald-500/5 to-transparent" />
            <div className="relative h-full flex items-center gap-4 p-5">
              <div className="relative flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 text-2xl shadow-lg group-hover:scale-105 transition-all duration-500">
                ✅
                <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/20 to-transparent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Скачено моделей
                </p>
                <p className="text-xl font-semibold group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-foreground group-hover:to-foreground/70 group-hover:bg-clip-text transition-all duration-300">
                  {installedModelsCount}
                </p>
              </div>
            </div>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-0 group-hover:opacity-30 transition-opacity duration-500" />
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
                    {download.speedMbS && ` • ${download.speedMbS} MB/s`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <span>🐍</span> Whisper Models
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {availableModels
                .filter((m) => m.modelType === "whisper")
                .map((model) => (
                  <ModelCard
                    key={model.name}
                    model={model}
                    download={downloads[model.name]}
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {availableModels
                .filter((m) => m.modelType === "parakeet")
                .map((model) => (
                  <ModelCard
                    key={model.name}
                    model={model}
                    download={downloads[model.name]}
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {availableModels
                .filter((m) => m.modelType === "diarization")
                .map((model) => (
                  <ModelCard
                    key={model.name}
                    model={model}
                    download={downloads[model.name]}
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
