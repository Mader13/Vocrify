import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Upload, AlertCircle, Loader2 } from "lucide-react";
import { Header } from "@/components/layout";
import { TranscriptionView, SettingsPanel, ModelsManagement, DiarizationOptionsModal, SetupWizardGuard, ArchiveView, Sidebar, MiniPlayer } from "@/components/features";
import { getTaskStatusById, useTasks, useUIStore, useSetupStore } from "@/stores";
import { subscribeToTranscriptionRuntime } from "@/services/transcription";
import { orchestrator } from "@/services/transcription-orchestrator";
import { initializeModelsStore, useModelsStore } from "@/stores/modelsStore";
import { initializeNotifications as initNotificationEmitter, destroyNotifications } from "@/services/notifications";
import { Button } from "@/components/ui/button";
import { NotificationProvider } from "@/components/ui/notifications";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { normalizeNumSpeakers } from "@/lib/speaker-utils";
import type { DiarizationProvider, AIModel, DeviceType, Language } from "@/types";
import type { FileWithSettings } from "@/components/features/DiarizationOptionsModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useModelValidation, useDropZone, useI18n } from "@/hooks";
import "./index.css";

interface SelectedFile {
  path: string;
  name: string;
  size: number;
}

interface LoadingScreenProps {
  message: string;
}

function LoadingScreen({ message }: LoadingScreenProps) {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function MainApplication() {
  const updateTaskProgress = useTasks((s) => s.updateTaskProgress);
  const updateTaskStatus = useTasks((s) => s.updateTaskStatus);
  const appendTaskSegment = useTasks((s) => s.appendTaskSegment);
  const appendStreamingSegment = useTasks((s) => s.appendStreamingSegment);
  const addTask = useTasks((s) => s.addTask);
  const updateLastDiarizationProvider = useTasks((s) => s.updateLastDiarizationProvider);
  const updateSettings = useTasks((s) => s.updateSettings);
  const currentView = useUIStore((s) => s.currentView);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);

  const { validateModelSelection, modelError, setModelError, selectedModel } = useModelValidation();
  const { t, locale } = useI18n();
  const { availableModels, loadModels } = useModelsStore();
  const {
    defaultDevice,
    defaultLanguage,
    diarizationProvider,
    enableDiarization,
    theme,
  } = useTasks((s) => s.settings);

  const [pendingFiles, setPendingFiles] = useState<SelectedFile[]>([]);
  const [isDiarizationModalOpen, setIsDiarizationModalOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    if (theme !== "system") {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    window.document.documentElement.lang = locale;
  }, [locale]);

  const handleFilesDropped = useCallback((files: SelectedFile[]) => {
    setPendingFiles((prev) => [...prev, ...files]);
    setIsDiarizationModalOpen(true);
  }, []);

  const { isDraggingGlobal, dragHandlers } = useDropZone({
    currentView,
    onFilesDropped: handleFilesDropped,
  });

  const mainContent = useMemo(() => {
    if (selectedTaskId) {
      return <TranscriptionView />;
    }

    if (currentView === "archive") {
      return <ArchiveView />;
    }

    if (currentView === "models") {
      return <ModelsManagement />;
    }

    if (currentView === "settings") {
      return null;
    }

    return <TranscriptionView />;
  }, [currentView, selectedTaskId]);

  useEffect(() => {
    if (currentView === "archive" || currentView === "models" || currentView === "settings") {
      setSelectedTask(null);
    } else if (currentView === "transcription") {
      // Clear selection if the selected task doesn't exist (but allow archived tasks)
      const task = useTasks.getState().tasks.find((t) => t.id === selectedTaskId);
      if (selectedTaskId && !task) {
        setSelectedTask(null);
      }
    }
  }, [currentView, setSelectedTask, selectedTaskId]);

  // NOTE: loadModels is intentionally NOT in the dependency array.
  // It's already called via initializeModelsStore() at startup.
  // Adding it here can cause infinite loops as the function reference may change.
  // Models are reloaded when the user visits the Models section via ModelsManagement component.
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    initializeModelsStore();

    initNotificationEmitter().catch((error: Error) => {
      logger.error("Failed to initialize notification emitter", { error });
    });

    let unlistenRuntime: (() => void) | null = null;

    subscribeToTranscriptionRuntime({
      updateTaskProgress,
      updateTaskStatus,
      appendTaskSegment,
      appendStreamingSegment,
      getTaskStatus: (taskId) => getTaskStatusById(taskId),
    }).then((unlisten) => {
      unlistenRuntime = unlisten;
    });

    return () => {
      unlistenRuntime?.();
      // Clean up NotificationEmitter to prevent duplicate event handlers
      try {
        logger.info("Cleaning up NotificationEmitter in useEffect");
        destroyNotifications();
      } catch (error) {
        logger.error("Failed to destroy NotificationEmitter", { error });
      }
    };
  }, [updateTaskProgress, updateTaskStatus, appendTaskSegment, appendStreamingSegment]);

  // Orchestrator handles: task queue processing, stale detection, pending deletion reconciliation
  useEffect(() => {
    orchestrator.start();
    return () => orchestrator.stop();
  }, []);

  const handleFilesFromDialog = useCallback((files: Array<{ path: string; name: string; size: number }>) => {
    if (!validateModelSelection()) {
      return;
    }

    logger.uploadInfo("Files selected from dialog", { count: files.length, files: files.map((f) => f.name) });
    setPendingFiles((prev) => [...prev, ...files]);
    setIsDiarizationModalOpen(true);
  }, [validateModelSelection]);

  const availableDiarizationProviders = useMemo((): DiarizationProvider[] => {
    const providers: DiarizationProvider[] = [];

    const sherpaInstalled = availableModels.some(
      (m) => m.name === "sherpa-onnx-diarization" && m.installed
    );
    if (sherpaInstalled) {
      providers.push("native");
    }

    return providers;
  }, [availableModels]);

  const validateDiarizationSettings = (
    enableDiarization: boolean,
    diarizationProvider: DiarizationProvider | null
  ): { valid: boolean; error?: string } => {
    if (enableDiarization) {
      if (!diarizationProvider || diarizationProvider === "none") {
        return {
          valid: false,
          error: t("app.invalidDiarizationMessage")
        };
      }
    }
    return { valid: true };
  };

  const handleModalConfirm = async (filesWithSettings: FileWithSettings[], rememberChoice: boolean) => {
    logger.info("Diarization modal confirmed", { rememberChoice, filesCount: filesWithSettings.length });

    for (const file of filesWithSettings) {
      const validation = validateDiarizationSettings(
        file.enableDiarization,
        file.diarizationProvider
      );

      if (!validation.valid) {
        setModelError({
          open: true,
          title: t("app.invalidDiarizationTitle"),
          message: validation.error || t("app.invalidDiarizationMessage")
        });
        logger.transcriptionError("Diarization validation failed", {
          fileName: file.name,
          error: validation.error
        });
        return;
      }
    }

    // Save settings if rememberChoice is true
    if (rememberChoice && filesWithSettings.length > 0) {
      const firstFile = filesWithSettings[0];
      const numSpeakersValue = normalizeNumSpeakers(firstFile.numSpeakers);
      logger.info("Saving diarization settings", {
        enableDiarization: firstFile.enableDiarization,
        provider: firstFile.diarizationProvider,
        numSpeakers: numSpeakersValue
      });
      updateSettings({
        enableDiarization: firstFile.enableDiarization,
        numSpeakers: numSpeakersValue
      });
      if (firstFile.enableDiarization && firstFile.diarizationProvider) {
        updateLastDiarizationProvider(firstFile.diarizationProvider);
      }
    } else {
      // Even if not remembering, still update provider for current session
      for (const file of filesWithSettings) {
        if (file.enableDiarization && file.diarizationProvider) {
          updateLastDiarizationProvider(file.diarizationProvider);
          break; // Only need to update once
        }
      }
    }

    for (const file of filesWithSettings) {
      await addTask(file.path, file.name, file.size, {
        model: selectedModel as AIModel,
        device: defaultDevice as DeviceType,
        language: (file.language ?? defaultLanguage) as Language,
        enableDiarization: file.enableDiarization,
        diarizationProvider: (file.enableDiarization ? file.diarizationProvider : "none") as DiarizationProvider,
        numSpeakers: normalizeNumSpeakers(file.numSpeakers),
        audioProfile: file.audioProfile,
      });
    }

    setIsDiarizationModalOpen(false);
    setPendingFiles([]);
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header />
      <MiniPlayer />

      <main
        ref={mainRef}
        className={cn(
          "relative flex flex-1 flex-col lg:flex-row pt-22 px-4 pb-4 gap-4 overflow-hidden",
          isDraggingGlobal && "cursor-copy"
        )}
        {...dragHandlers}
      >
        {isDraggingGlobal && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 pointer-events-none rounded-2xl mx-4 mb-4">
            <div className="bg-background/90 backdrop-blur-sm rounded-3xl border-2 border-dashed border-primary p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-full bg-primary/10 p-4">
                  <Upload className="h-12 w-12 text-primary" />
                </div>
                <p className="text-lg font-medium text-primary">{t("app.dropOverlay")}</p>
              </div>
            </div>
          </div>
        )}

        <Sidebar onFilesSelected={handleFilesFromDialog} />

        <div className="min-h-0 flex-1 overflow-hidden bg-background/60 backdrop-blur-xl border border-border/50 rounded-2xl lg:rounded-3xl shadow-2xl flex flex-col p-4 relative z-0">
          {mainContent}
        </div>
      </main>

      <SettingsPanel />

      <DiarizationOptionsModal
        isOpen={isDiarizationModalOpen}
        onClose={() => {
          setIsDiarizationModalOpen(false);
          setPendingFiles([]);
        }}
        onConfirm={handleModalConfirm}
        files={pendingFiles}
        availableDiarizationProviders={availableDiarizationProviders}
        lastUsedProvider={diarizationProvider as DiarizationProvider}
        lastUsedEnableDiarization={enableDiarization}
        defaultLanguage={defaultLanguage as Language}
      />

      <Dialog open={modelError.open} onOpenChange={(open) => setModelError({ ...modelError, open })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-destructive/10 p-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <DialogTitle>{modelError.title}</DialogTitle>
            </div>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">{modelError.message}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setModelError({ ...modelError, open: false })}>
              {t("common.ok")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function App() {
  const { initialize } = useSetupStore();
  const [isInitialized, setIsInitialized] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      await initialize();
      if (mounted) setIsInitialized(true);
    };
    init();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isInitialized) {
    return <LoadingScreen message={t("app.loadingStatus")} />;
  }

  return (
    <NotificationProvider>
      <SetupWizardGuard>
        <MainApplication />
      </SetupWizardGuard>
    </NotificationProvider>
  );
}

export default App;
