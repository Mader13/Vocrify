import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { Upload, AlertCircle, Loader2 } from "lucide-react";
import { Header } from "@/components/layout";
import { TranscriptionView, SettingsPanel, ModelsManagement, DiarizationOptionsModal, SetupWizardGuard, ArchiveView, Sidebar } from "@/components/features";
import { useTasks, useUIStore, useSetupStore } from "@/stores";
import {
  onProgressUpdate,
  onTranscriptionError,
  onSegmentUpdate,
} from "@/services/tauri";
import { transcribeWithFallback } from "@/services/transcription";
import { initializeModelsStore, useModelsStore } from "@/stores/modelsStore";
import { initializeNotifications as initNotificationCenter } from "@/components/ui/notification-center";
import { initializeNotifications as initNotificationEmitter } from "@/services/notifications";
import { Button } from "@/components/ui/button";
import { NotificationProvider } from "@/components/ui/notifications";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { DiarizationProvider, AIModel, DeviceType, Language, TranscriptionResult } from "@/types";
import type { FileWithSettings } from "@/components/features/DiarizationOptionsModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useModelValidation, useDropZone } from "@/hooks";
import "./index.css";

interface SelectedFile {
  path: string;
  name: string;
  size: number;
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
  const { defaultDevice, defaultLanguage, diarizationProvider, enginePreference } = useTasks((s) => s.settings);

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
    if (currentView === "archive") {
      setSelectedTask(null);
    } else if (currentView === "transcription") {
      // Clear selection if the selected task doesn't exist (but allow archived tasks)
      const task = useTasks.getState().tasks.find((t) => t.id === selectedTaskId);
      if (selectedTaskId && !task) {
        setSelectedTask(null);
      }
    }
  }, [currentView, setSelectedTask]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    initializeModelsStore();

    initNotificationCenter().catch((error: Error) => {
      logger.error("Failed to initialize notification center", { error });
    });

    initNotificationEmitter().catch((error: Error) => {
      logger.error("Failed to initialize notification emitter", { error });
    });

    const unsubscribers: (() => void)[] = [];

    onProgressUpdate((event) => {
      updateTaskProgress(event.taskId, event.progress, event.stage, event.metrics);
    }).then((unlisten) => unsubscribers.push(unlisten));

    // Listen to CustomEvent from transcription.ts (Rust path)
    const handleTranscriptionComplete = (e: CustomEvent<{ taskId: string; result: TranscriptionResult }>) => {
      const { taskId, result } = e.detail;
      logger.transcriptionDebug("Transcription complete", {
        taskId,
        segments: result.segments?.length,
        speakerTurns: result.speakerTurns?.length,
        speakerSegments: result.speakerSegments?.length,
        hasSpeakerData: !!(result.speakerTurns && result.speakerTurns.length > 0)
      });
      if (result.speakerTurns) {
        logger.transcriptionDebug("Speaker turns", { taskId, speakerTurns: result.speakerTurns.slice(0, 3) });
      }
      if (result.speakerSegments) {
        logger.transcriptionDebug("Speaker segments", { taskId, speakerSegments: result.speakerSegments.slice(0, 3) });
      }
      updateTaskStatus(taskId, "completed", result);
    };
    window.addEventListener("transcription-complete", handleTranscriptionComplete as EventListener);
    unsubscribers.push(() => window.removeEventListener("transcription-complete", handleTranscriptionComplete as EventListener));

    onTranscriptionError((taskId, error) => {
      const existingTask = useTasks.getState().tasks.find((t) => t.id === taskId);

      if (existingTask?.status === "completed" || existingTask?.status === "cancelled" || existingTask?.status === "interrupted") {
        logger.transcriptionWarn("Ignoring late transcription error for finalized task", {
          taskId,
          status: existingTask.status,
          error,
        });
        return;
      }

      updateTaskStatus(taskId, "failed", undefined, error);
    }).then((unlisten) => unsubscribers.push(unlisten));

    onSegmentUpdate(({ taskId, segment }) => {
      appendTaskSegment(taskId, segment.segment, segment.index, segment.total);
      appendStreamingSegment(taskId, segment.segment);
    }).then((unlisten) => unsubscribers.push(unlisten));

    return () => {
      unsubscribers.forEach((unlisten) => unlisten());
    };
  }, [updateTaskProgress, updateTaskStatus, appendTaskSegment, appendStreamingSegment]);

  useEffect(() => {
    const STALE_THRESHOLD_MS = 2 * 60 * 1000;
    const CHECK_INTERVAL_MS = 30 * 1000;

    const checkStaleTasks = () => {
      const now = Date.now();
      const tasks = useTasks.getState().tasks;

      tasks.forEach((task) => {
        if (task.status === "processing") {
          const lastProgressTime = task.lastProgressUpdate ?? 0;
          const timeSinceLastUpdate = now - lastProgressTime;

          if (timeSinceLastUpdate > STALE_THRESHOLD_MS && lastProgressTime > 0) {
            logger.transcriptionWarn("Marking task as interrupted - no progress updates received", {
              taskId: task.id,
              timeSinceLastUpdate,
            });
            updateTaskStatus(task.id, "interrupted", undefined, "Transcription was interrupted: no progress received from backend. The task may have failed or been terminated.");
          }
        }
      });
    };

    const intervalId = setInterval(checkStaleTasks, CHECK_INTERVAL_MS);
    checkStaleTasks();

    return () => clearInterval(intervalId);
  }, [updateTaskStatus]);

  useEffect(() => {
    const processedTasks = new Set<string>();

    logger.transcriptionDebug("Processing tasks", { total: tasks.length });
    tasks.forEach((task) => {
      logger.transcriptionDebug("Task status", { taskId: task.id, status: task.status });
      if (task.status === "queued" && !processedTasks.has(task.id)) {
        logger.transcriptionInfo("Starting task", { taskId: task.id, fileName: task.filePath });
        processedTasks.add(task.id);
        updateTaskStatus(task.id, "processing");
        transcribeWithFallback(task.id, task.filePath, task.options, enginePreference).catch((error) => {
          logger.transcriptionError("Task failed", { taskId: task.id, error });
          updateTaskStatus(task.id, "failed", undefined, error.message);
        });
      }
    });
  }, [tasks, updateTaskStatus, enginePreference]);

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
      if (firstFile.enableDiarization && firstFile.diarizationProvider) {
        updateLastDiarizationProvider(firstFile.diarizationProvider);
        updateSettings({ numSpeakers: firstFile.numSpeakers === "auto" ? 2 : firstFile.numSpeakers });
      }
    }

    for (const file of filesWithSettings) {
      if (file.enableDiarization && file.diarizationProvider) {
        if (!rememberChoice) {
          updateLastDiarizationProvider(file.diarizationProvider);
        }
      }

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
      ) : (
        <main className="flex-1 overflow-hidden">
          <ModelsManagement />
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
