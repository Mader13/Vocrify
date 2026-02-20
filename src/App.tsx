import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Upload, AlertCircle, Loader2 } from "lucide-react";
import { Header } from "@/components/layout";
import { TranscriptionView, SettingsPanel, ModelsManagement, DiarizationOptionsModal, SetupWizardGuard, ArchiveView, Sidebar, MiniPlayer, VideoPlayer } from "@/components/features";
import { getTaskStatusById, useTasks, useUIStore, useSetupStore, usePlaybackStore } from "@/stores";
import {
  subscribeToTranscriptionRuntime,
  transcribeWithFallback,
} from "@/services/transcription";
import { getQueuedTaskIdsToStart } from "@/services/transcription-queue";
import { collectStaleProcessingTaskIds } from "@/services/transcription-heartbeat";
import { initializeModelsStore, useModelsStore } from "@/stores/modelsStore";
import { initializeNotifications as initNotificationEmitter, getNotificationEmitter } from "@/services/notifications";
import { Button } from "@/components/ui/button";
import { NotificationProvider } from "@/components/ui/notifications";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { DiarizationProvider, AIModel, DeviceType, Language } from "@/types";
import type { FileWithSettings } from "@/components/features/DiarizationOptionsModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useModelValidation, useDropZone } from "@/hooks";
import "./index.css";

interface SelectedFile {
  path: string;
  name: string;
  size: number;
}

/**
 * BackgroundPlayer keeps the audio/video element alive (in the DOM) when the user
 * navigates away from the playing task's page. Without this, the media element
 * is unmounted and audio stops. This hidden player maintains playback so MiniPlayer
 * controls (play/pause) still work across navigation.
 */
function BackgroundPlayer() {
  const playingTaskId = usePlaybackStore((s) => s.playingTaskId);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const currentView = useUIStore((s) => s.currentView);
  const tasks = useTasks((s) => s.tasks);

  const isPlayingTaskVisible = currentView === "transcription" && selectedTaskId === playingTaskId;

  // Render whenever the currently playing task is not visible on screen.
  // This includes non-transcription views where selectedTaskId can still
  // temporarily point at the playing task during view transitions.
  const shouldRender = playingTaskId !== null && !isPlayingTaskVisible;
  const task = shouldRender
    ? tasks.find((t) => t.id === playingTaskId && t.status === "completed")
    : undefined;

  if (!task) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        // opacity:0 (not visibility:hidden) keeps the element geometrically
        // present so IntersectionObserver fires and WaveSurfer initializes.
        // audio/video playback continues normally while invisible to the user.
        opacity: 0,
        pointerEvents: "none",
        // Give enough width so WaveSurfer can measure its container
        width: "300px",
        height: "100px",
        zIndex: -1,
        top: 0,
        left: 0,
        overflow: "hidden",
      }}
    >
      <VideoPlayer
        task={task}
        colorMode="segments"
        isVideoVisible
      />
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Checking status...</p>
      </div>
    </div>
  );
}

function MainApplication() {
  const tasks = useTasks((s) => s.tasks);
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
  const { availableModels, loadModels } = useModelsStore();
  const {
    defaultDevice,
    defaultLanguage,
    diarizationProvider,
    enginePreference,
    enableDiarization,
    maxConcurrentTasks,
  } = useTasks((s) => s.settings);

  const [pendingFiles, setPendingFiles] = useState<SelectedFile[]>([]);
  const [isDiarizationModalOpen, setIsDiarizationModalOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  const handleFilesDropped = useCallback((files: SelectedFile[]) => {
    setPendingFiles((prev) => [...prev, ...files]);
    setIsDiarizationModalOpen(true);
  }, []);

  const { isDraggingGlobal, dragHandlers } = useDropZone({
    currentView,
    onFilesDropped: handleFilesDropped,
  });

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
        const emitter = getNotificationEmitter();
        logger.info("Cleaning up NotificationEmitter in useEffect");
        emitter.destroy();
      } catch (error) {
        logger.error("Failed to destroy NotificationEmitter", { error });
      }
    };
  }, [updateTaskProgress, updateTaskStatus, appendTaskSegment, appendStreamingSegment]);

  useEffect(() => {
    const STALE_THRESHOLD_MS = 2 * 60 * 1000;
    const CHECK_INTERVAL_MS = 30 * 1000;

    const checkStaleTasks = () => {
      const now = Date.now();
      const tasks = useTasks.getState().tasks;
      const staleTaskIds = collectStaleProcessingTaskIds(tasks, now, STALE_THRESHOLD_MS);

      staleTaskIds.forEach((taskId) => {
        const task = tasks.find((item) => item.id === taskId);
        const timeSinceLastUpdate = task?.lastProgressUpdate ? now - task.lastProgressUpdate : undefined;

        logger.transcriptionWarn("Marking task as interrupted - no progress updates received", {
          taskId,
          timeSinceLastUpdate,
        });
        updateTaskStatus(taskId, "interrupted", undefined, "Transcription was interrupted: no progress received from backend. The task may have failed or been terminated.");
      });
    };

    const intervalId = setInterval(checkStaleTasks, CHECK_INTERVAL_MS);
    checkStaleTasks();

    return () => clearInterval(intervalId);
  }, [updateTaskStatus]);

  useEffect(() => {
    const processedTasks = new Set<string>();
    const startTaskIds = new Set(getQueuedTaskIdsToStart(tasks, maxConcurrentTasks));

    logger.transcriptionDebug("Processing tasks", { total: tasks.length });
    tasks.forEach((task) => {
      logger.transcriptionDebug("Task status", { taskId: task.id, status: task.status });
      if (task.status === "queued" && startTaskIds.has(task.id) && !processedTasks.has(task.id) && task.filePath) {
        logger.transcriptionInfo("Starting task", { taskId: task.id, fileName: task.filePath });
        processedTasks.add(task.id);
        updateTaskStatus(task.id, "processing");
        transcribeWithFallback(task.id, task.filePath, task.options, enginePreference).catch((error) => {
          logger.transcriptionError("Task failed", { taskId: task.id, error });
          updateTaskStatus(task.id, "failed", undefined, error.message);
        });
      }
    });
  }, [tasks, updateTaskStatus, enginePreference, maxConcurrentTasks]);

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

    const pyannoteInstalled = availableModels.some(
      (m) => m.name === "pyannote-diarization" && m.installed
    );
    if (pyannoteInstalled) {
      providers.push("pyannote");
    }

    const sherpaInstalled = availableModels.some(
      (m) => m.name === "sherpa-onnx-diarization" && m.installed
    );
    if (sherpaInstalled) {
      providers.push("sherpa-onnx");
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
          error: "Diarization requires a diarization model to be installed. Please install pyannote or sherpa-onnx model first."
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
          title: "Invalid Diarization Configuration",
          message: validation.error || "Unknown error"
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
      const numSpeakersValue = firstFile.numSpeakers === "auto" ? 2 : firstFile.numSpeakers;
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
        language: defaultLanguage as Language,
        enableDiarization: file.enableDiarization,
        diarizationProvider: (file.enableDiarization ? file.diarizationProvider : "none") as DiarizationProvider,
        numSpeakers: file.numSpeakers === "auto" ? -1 : file.numSpeakers,
      });
    }

    setIsDiarizationModalOpen(false);
    setPendingFiles([]);
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header />
      <MiniPlayer />
      <BackgroundPlayer />

      {currentView === "transcription" || currentView === "archive" ? (
        <main
          ref={mainRef}
          className={cn(
            "flex flex-1 overflow-hidden flex-col lg:flex-row relative",
            isDraggingGlobal && "cursor-copy"
          )}
          {...dragHandlers}
        >
          {isDraggingGlobal && (
            <div className="absolute inset-0 bg-primary/10 z-50 flex items-center justify-center pointer-events-none">
              <div className="bg-background/90 backdrop-blur-sm rounded-2xl border-2 border-dashed border-primary p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                <div className="flex flex-col items-center gap-4">
                  <div className="rounded-full bg-primary/10 p-4">
                    <Upload className="h-12 w-12 text-primary" />
                  </div>
                  <p className="text-lg font-medium text-primary">Drop files to add to queue</p>
                </div>
              </div>
            </div>
          )}

          <Sidebar onFilesSelected={handleFilesFromDialog} />

          <div className="flex-1 p-4 overflow-hidden min-h-0">
            {selectedTaskId ? <TranscriptionView /> : (currentView === "archive" ? <ArchiveView /> : <TranscriptionView />)}
          </div>
        </main>
      ) : currentView === "models" ? (
        <main className="flex-1 overflow-hidden">
          <ModelsManagement />
        </main>
      ) : (
        <main className="flex-1 overflow-hidden">
          {/* Settings view - SettingsPanel renders as modal */}
        </main>
      )}

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
              OK
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
    return <LoadingScreen />;
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
