import * as React from "react";
import {
  CheckCircle2,
  FolderOpen,
  Loader2,
  Mic,
  Sparkles,
  TriangleAlert,
  Waves,
} from "lucide-react";

import { ModelCard } from "@/components/features/ModelCard";
import {
  getModelsPageLayoutMode,
  type ModelsPageLayoutMode,
} from "@/components/features/models-management-layout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/hooks";
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
  return (
    <section className="rounded-2xl bg-card/40 border border-transparent p-4 sm:p-5 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2.5 text-base font-semibold sm:text-lg text-foreground/90">
            {icon}
            <span>{title}</span>
          </h2>
          <p className="mt-1.5 text-[14px] leading[1.6] text-muted-foreground/80">{description}</p>
        </div>
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
  const modelsActiveTab = useUIStore((state) => state.modelsActiveTab);
  const setModelsActiveTab = useUIStore((state) => state.setModelsActiveTab);

  const [isLoading, setIsLoading] = React.useState(true);
  const [layoutMode, setLayoutMode] = React.useState<ModelsPageLayoutMode>("stacked");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { t } = useI18n();

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
  const gigaamModels = React.useMemo(
    () =>
      availableModels
        .filter((model) => model.modelType === "gigaam")
        .map((model) =>
          model.name === "gigaam-v3"
            ? { ...model, description: t("models.gigaamModelNote") }
            : model,
        ),
    [availableModels, t],
  );
  const diarizationModels = React.useMemo(
    () => availableModels.filter((model) => model.modelType === "diarization"),
    [availableModels],
  );
  const isDiarizationInstalled = React.useMemo(
    () => diarizationModels.some((model) => model.installed),
    [diarizationModels],
  );
  const selectedModelLabel = selectedTranscriptionModel
    ? MODEL_NAMES[selectedTranscriptionModel as keyof typeof MODEL_NAMES] ?? selectedTranscriptionModel
    : t("models.noModelSelected");

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
          <span>{t("models.loadingModels")}</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-345 space-y-4">
        <section className="rounded-2xl bg-card/40 border border-transparent p-4 sm:p-5 lg:p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">


              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl text-foreground">{t("models.title")}</h1>


            <Button onClick={handleOpenModelsFolder} variant="outline" className="h-9 gap-2 self-start bg-background/50 backdrop-blur-sm border-border/40 hover:bg-muted/80">
              <FolderOpen className="h-4 w-4" />
              {t("models.openFolder")}
            </Button>
          </div>

          <div
            className={cn(
              "mt-5 grid gap-3",
              layoutMode === "split" ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
            )}
          >
            <div className="rounded-xl border border-transparent bg-background/40 backdrop-blur-md p-3 sm:p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/80">{t("models.selectedModel")}</p>
              <p className="mt-2.5 line-clamp-2 text-base font-bold sm:text-[19px] leading-tight text-foreground/90">{selectedModelLabel}</p>
            </div>

            <div className="rounded-xl border border-transparent bg-background/40 backdrop-blur-md p-3 sm:p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/80">{t("models.diarizationLabel")}</p>
              <p
                className={cn(
                  "mt-2.5 inline-flex items-center gap-2 text-base font-bold sm:text-[19px] leading-tight",
                  isDiarizationInstalled ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                )}
              >
                {isDiarizationInstalled ? (
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <TriangleAlert className="h-5 w-5" aria-hidden="true" />
                )}
                {isDiarizationInstalled ? t("models.installed") : t("models.notInstalled")}
              </p>
            </div>

            <div className="rounded-xl border border-transparent bg-background/40 backdrop-blur-md p-3 sm:p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/80">{t("models.diskUsage")}</p>
              <p className="mt-2.5 text-lg font-bold sm:text-[19px] leading-tight text-foreground/90">{formatSizeMb(diskUsage.totalSizeMb)}</p>
            </div>
          </div>
        </section>

        <Tabs value={modelsActiveTab} onValueChange={(v) => setModelsActiveTab(v as "transcription" | "diarization")} className="w-full">
          <TabsList
            variant="outline"
            className="h-auto gap-1 border-transparent bg-muted/40 backdrop-blur-md p-1.5 *:h-9 *:rounded-lg *:px-5 *:text-[13px] *:font-medium transition-all"
          >
            <TabsTrigger
              value="transcription"
              className="gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm text-muted-foreground/80"
            >
              <Waves className="h-4 w-4" />
              {t("models.transcriptionTab")}
            </TabsTrigger>
            <TabsTrigger
              value="diarization"
              className="gap-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm text-muted-foreground/80"
            >
              <Mic className="h-4 w-4" />
              {t("models.diarizationTab")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="transcription" className="mt-4 space-y-4">
            <div className={cn("grid gap-4", layoutMode === "split" ? "xl:grid-cols-2" : "grid-cols-1")}>
              <ModelSectionPanel
                title={t("models.whisperTitle")}
                description={t("models.whisperDesc")}
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
                title={t("models.parakeetTitle")}
                description={t("models.parakeetDesc")}
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

              <ModelSectionPanel
                title={t("models.gigaamTitle")}
                description={t("models.gigaamDesc")}
                icon={<Waves className="h-4 w-4 text-muted-foreground" />}
                models={gigaamModels}
                downloads={downloads}
                deletingModels={deletingModels}
                pendingModelDeletions={pendingModelDeletions}
                selectedModelName={selectedTranscriptionModel}
                canSelect
                onSelectModel={setSelectedTranscriptionModel}
                onDownloadModel={downloadModel}
                onCancelDownload={cancelModelDownload}
                onDeleteModel={deleteModel}
                animationOffsetMs={200}
              />
            </div>
          </TabsContent>

          <TabsContent value="diarization" className="mt-4 space-y-4">
            <ModelSectionPanel
              title={t("models.diarizationTitle")}
              description={t("models.diarizationDesc")}
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
