import * as React from "react";
import {
  CheckCircle2,
  FolderOpen,
  Loader2,
  Mic,
  Sparkles,
  Waves,
} from "lucide-react";

import { HuggingFaceTokenCard } from "@/components/features/HuggingFaceTokenCard";
import { ModelCard } from "@/components/features/ModelCard";
import {
  getModelsPageLayoutMode,
  type ModelsPageLayoutMode,
} from "@/components/features/models-management-layout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { logger } from "@/lib/logger";
import { cn, formatSizeMb } from "@/lib/utils";
import { openModelsFolder } from "@/services/tauri";
import { useUIStore } from "@/stores";
import { useModelsStore } from "@/stores/modelsStore";
import { MODEL_NAMES } from "@/types";
import type { AvailableModel, ModelType } from "@/types";

interface ModelSectionPanelProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  models: AvailableModel[];
  downloads: ReturnType<typeof useModelsStore.getState>["downloads"];
  deletingModels: ReturnType<typeof useModelsStore.getState>["deletingModels"];
  pendingModelDeletions: ReturnType<typeof useModelsStore.getState>["pendingModelDeletions"];
  selectedModelName?: string | null;
  canSelect?: boolean;
  onSelectModel?: (name: string) => void;
  onDownloadModel: (name: string, type: ModelType) => void;
  onCancelDownload: (name: string) => void;
  onDeleteModel: (name: string) => void;
  animationOffsetMs?: number;
}

function ModelSectionPanel({
  title,
  description,
  icon,
  models,
  downloads,
  deletingModels,
  pendingModelDeletions,
  selectedModelName,
  canSelect = false,
  onSelectModel,
  onDownloadModel,
  onCancelDownload,
  onDeleteModel,
  animationOffsetMs = 0,
}: ModelSectionPanelProps): React.JSX.Element {
  const installedCount = models.filter((model) => model.installed).length;

  return (
    <section className="rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
            {icon}
            <span>{title}</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <span className="rounded-md border border-border/70 bg-background/80 px-2 py-1 text-xs text-muted-foreground">
          {installedCount}/{models.length} installed
        </span>
      </div>

      <div className="space-y-3">
        {models.map((model, index) => (
          <ModelCard
            key={model.name}
            model={model}
            download={downloads[model.name]}
            animationDelayMs={animationOffsetMs + index * 45}
            onDownload={() => onDownloadModel(model.name, model.modelType)}
            onDownloadCancel={() => onCancelDownload(model.name)}
            onDelete={() => onDeleteModel(model.name)}
            isDeleting={Boolean(deletingModels[model.name])}
            pendingDeletion={Boolean(pendingModelDeletions[model.name])}
            pendingDeletionError={pendingModelDeletions[model.name]?.lastError}
            onSelect={canSelect && onSelectModel ? () => onSelectModel(model.name) : undefined}
            isSelected={canSelect ? selectedModelName === model.name : false}
          />
        ))}
      </div>
    </section>
  );
}

export function ModelsManagement(): React.JSX.Element {
  const {
    availableModels,
    downloads,
    deletingModels,
    pendingModelDeletions,
    diskUsage,
    selectedTranscriptionModel,
    loadModels,
    loadDiskUsage,
    downloadModel,
    deleteModel,
    cancelModelDownload,
    setSelectedTranscriptionModel,
  } = useModelsStore();

  const isSidebarCollapsed = useUIStore((state) => state.isSidebarCollapsed);

  const [isLoading, setIsLoading] = React.useState(true);
  const [layoutMode, setLayoutMode] = React.useState<ModelsPageLayoutMode>("stacked");
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      logger.modelDebug("ModelsManagement: loading models and disk usage");
      await Promise.all([loadModels(), loadDiskUsage()]);
      logger.modelDebug("ModelsManagement: load complete");
      setIsLoading(false);
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateLayoutMode = (width: number) => {
      setLayoutMode(
        getModelsPageLayoutMode(width, {
          sidebarCollapsed: isSidebarCollapsed,
        }),
      );
    };

    updateLayoutMode(container.clientWidth);

    if (typeof ResizeObserver === "undefined") {
      const onResize = () => updateLayoutMode(container.clientWidth);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateLayoutMode(entry.contentRect.width);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [isSidebarCollapsed]);

  const whisperModels = React.useMemo(
    () => availableModels.filter((model) => model.modelType === "whisper"),
    [availableModels],
  );
  const parakeetModels = React.useMemo(
    () => availableModels.filter((model) => model.modelType === "parakeet"),
    [availableModels],
  );
  const diarizationModels = React.useMemo(
    () => availableModels.filter((model) => model.modelType === "diarization"),
    [availableModels],
  );

  const selectedModelLabel = selectedTranscriptionModel
    ? MODEL_NAMES[selectedTranscriptionModel as keyof typeof MODEL_NAMES] ?? selectedTranscriptionModel
    : "No model selected";

  const handleOpenModelsFolder = async () => {
    const result = await openModelsFolder();
    if (!result.success) {
      logger.modelError("Failed to open models folder", { error: result.error });
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/80 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading models control room...</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-[1380px] space-y-4">
        <section className="rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5 lg:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">


              <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Models</h1>


            <Button onClick={handleOpenModelsFolder} variant="outline" className="h-10 gap-2 self-start">
              <FolderOpen className="h-4 w-4" />
              Open Models Folder
            </Button>
          </div>

          <div
            className={cn(
              "mt-5 grid gap-3",
              layoutMode === "split" ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2",
            )}
          >
            <div className="rounded-xl border border-border/70 bg-background/80 p-3 sm:p-4">
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Selected model</p>
              <p className="mt-2 line-clamp-2 text-base font-semibold sm:text-xl">{selectedModelLabel}</p>
            </div>

            <div className="rounded-xl border border-border/70 bg-background/80 p-3 sm:p-4">
              <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Disk usage</p>
              <p className="mt-2 text-lg font-semibold sm:text-xl">{formatSizeMb(diskUsage.totalSizeMb)}</p>
            </div>
          </div>
        </section>

        <Tabs defaultValue="transcription" className="w-full">
          <TabsList
            variant="outline"
            className="h-auto gap-1 border-border/70 bg-card/70 p-1.5 [&>*]:h-9 [&>*]:rounded-lg [&>*]:px-4"
          >
            <TabsTrigger
              value="transcription"
              className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <Waves className="h-4 w-4" />
              Transcription
            </TabsTrigger>
            <TabsTrigger
              value="diarization"
              className="gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
            >
              <Mic className="h-4 w-4" />
              Diarization
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transcription" className="mt-4 space-y-4">
            <div className={cn("grid gap-4", layoutMode === "split" ? "xl:grid-cols-2" : "grid-cols-1")}>
              <ModelSectionPanel
                title="Whisper Models"
                description="OpenAI Whisper family for broad multilingual transcription use-cases."
                icon={<Sparkles className="h-4 w-4 text-muted-foreground" />}
                models={whisperModels}
                downloads={downloads}
                deletingModels={deletingModels}
                pendingModelDeletions={pendingModelDeletions}
                selectedModelName={selectedTranscriptionModel}
                canSelect
                onSelectModel={setSelectedTranscriptionModel}
                onDownloadModel={downloadModel}
                onCancelDownload={cancelModelDownload}
                onDeleteModel={deleteModel}
              />

              <ModelSectionPanel
                title="Parakeet Models"
                description="NVIDIA-optimized models for high-throughput GPU pipelines."
                icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
                models={parakeetModels}
                downloads={downloads}
                deletingModels={deletingModels}
                pendingModelDeletions={pendingModelDeletions}
                selectedModelName={selectedTranscriptionModel}
                canSelect
                onSelectModel={setSelectedTranscriptionModel}
                onDownloadModel={downloadModel}
                onCancelDownload={cancelModelDownload}
                onDeleteModel={deleteModel}
                animationOffsetMs={120}
              />
            </div>
          </TabsContent>

          <TabsContent value="diarization" className="mt-4 space-y-4">
            <section className={cn("grid gap-4", layoutMode === "split" ? "xl:grid-cols-[minmax(320px,0.9fr)_minmax(420px,1.1fr)]" : "grid-cols-1")}
            >
              <div className="rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5">
                <h2 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
                  <Mic className="h-4 w-4 text-muted-foreground" />
                  HuggingFace Access
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Optional — not required for Sherpa-ONNX diarization.
                </p>
                <HuggingFaceTokenCard className="mt-4" />
              </div>

              <ModelSectionPanel
                title="Diarization Models"
                description="Speaker separation models used after transcription stage."
                icon={<Mic className="h-4 w-4 text-muted-foreground" />}
                models={diarizationModels}
                downloads={downloads}
                deletingModels={deletingModels}
                pendingModelDeletions={pendingModelDeletions}
                onDownloadModel={downloadModel}
                onCancelDownload={cancelModelDownload}
                onDeleteModel={deleteModel}
                animationOffsetMs={220}
              />
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
