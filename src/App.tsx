import { useEffect, useState, useRef, useCallback } from "react";
import { PanelLeftClose, PanelLeftOpen, Plus, Upload, AlertCircle, Loader2, Archive } from "lucide-react";
import { Header } from "@/components/layout";
import { DropZone, TaskList, TranscriptionView, SettingsPanel, ModelsManagement, DiarizationOptionsModal, ModelWarning, SetupWizardGuard, ArchiveView } from "@/components/features";
import { useTasks, useUIStore, useSetupStore } from "@/stores";
import {
  onProgressUpdate,
  onTranscriptionComplete,
  onTranscriptionError,
  onSegmentUpdate,
  selectMediaFiles,
} from "@/services/tauri";
import { transcribeWithFallback } from "@/services/transcription";
import { initializeModelsStore, useModelsStore } from "@/stores/modelsStore";
import { initializeNotifications } from "@/components/ui/notification-center";
import { Button } from "@/components/ui/button";
import { NotificationProvider } from "@/components/ui/notifications";
import { cn, isMediaFile } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { DiarizationProvider, AIModel, DeviceType, Language } from "@/types";
import type { FileWithSettings } from "@/components/features/DiarizationOptionsModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useModelValidation } from "@/hooks";
import "./index.css";

const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 320;
const COLLAPSED_SIDEBAR_WIDTH = 72;

interface SelectedFile {
  path: string;
  name: string;
  size: number;
}

/**
 * Loading screen shown while checking setup status
 */
function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Проверка состояния...</p>
      </div>
    </div>
  );
}

/**
 * Main application content (shown after setup is complete)
 */
function MainApplication() {
  const tasks = useTasks((s) => s.tasks);
  const updateTaskProgress = useTasks((s) => s.updateTaskProgress);
  const updateTaskStatus = useTasks((s) => s.updateTaskStatus);
  const appendTaskSegment = useTasks((s) => s.appendTaskSegment);
  const appendStreamingSegment = useTasks((s) => s.appendStreamingSegment);
  const addTask = useTasks((s) => s.addTask);
  const updateLastDiarizationProvider = useTasks((s) => s.updateLastDiarizationProvider);
  const currentView = useUIStore((s) => s.currentView);
  const isSidebarCollapsed = useUIStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const isDraggingGlobal = useUIStore((s) => s.isDragging);
  const setDraggingGlobal = useUIStore((s) => s.setDragging);

  // Model validation hook - replaces duplicate model checking code
  const { validateModelSelection, modelError, setModelError, selectedModel } = useModelValidation();
  const { availableModels, loadModels } = useModelsStore();
  const { defaultDevice, defaultLanguage, diarizationProvider, enginePreference } = useTasks((s) => s.settings);

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<SelectedFile[]>([]);
  const [isDiarizationModalOpen, setIsDiarizationModalOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  // Load models on mount
  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Subscribe to Tauri events
  useEffect(() => {
    initializeModelsStore();

    // Initialize notification service for backend events
    initializeNotifications().catch((error) => {
      logger.error("Failed to initialize notifications", { error });
    });

    const unsubscribers: (() => void)[] = [];

    onProgressUpdate((event) => {
      updateTaskProgress(event.taskId, event.progress, event.stage, event.metrics);
    }).then((unlisten) => unsubscribers.push(unlisten));

    onTranscriptionComplete((taskId, result) => {
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
    }).then((unlisten) => unsubscribers.push(unlisten));

    onTranscriptionError((taskId, error) => {
      const existingTask = useTasks.getState().tasks.find((t) => t.id === taskId);

      // Ignore late errors if task is already finalized on UI side
      if (existingTask?.status === "completed" || existingTask?.status === "cancelled") {
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

  // Process queued tasks
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

  // Resize handlers
  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleResize = useCallback((e: MouseEvent) => {
    if (!isResizing || !mainRef.current) return;
    
    const mainRect = mainRef.current.getBoundingClientRect();
    const newWidth = e.clientX - mainRect.left;
    const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));
    setSidebarWidth(clampedWidth);
  }, [isResizing]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResize);
      window.addEventListener('mouseup', handleResizeEnd);
      return () => {
        window.removeEventListener('mousemove', handleResize);
        window.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing, handleResize, handleResizeEnd]);

  // Global drag & drop for entire document (needed for Tauri)
  useEffect(() => {
    if (currentView !== "transcription") return;

    const handleDocumentDragOver = (e: DragEvent) => {
      e.preventDefault();
      logger.uploadDebug("[Drag] Document dragover");
      if (e.dataTransfer?.types.includes('Files')) {
        setDraggingGlobal(true);
      }
    };

    const handleDocumentDragLeave = (e: DragEvent) => {
      // Only trigger when leaving the window
      if (e.relatedTarget === null) {
        logger.uploadDebug("[Drag] Document dragleave (leaving window)");
        setDraggingGlobal(false);
      }
    };

    const handleDocumentDrop = (e: DragEvent) => {
      e.preventDefault();
      logger.uploadDebug("[Drag] Document drop");
      setDraggingGlobal(false);

      const files = Array.from(e.dataTransfer?.files || []);
      logger.uploadDebug("[Drag] Dropped files count:", { count: files.length });

      if (files.length > 0) {
        const validFiles: SelectedFile[] = [];

        files.forEach((file) => {
          logger.uploadDebug("[Drag] Processing file:", { fileName: file.name });
          if (isMediaFile(file.name)) {
            const filePath = (file as { path?: string }).path || file.name;
            validFiles.push({
              path: filePath,
              name: file.name,
              size: file.size,
            });
          }
        });

        if (validFiles.length > 0) {
          // Check if transcription model is selected using validation hook
          if (!validateModelSelection()) {
            return;
          }

          logger.uploadDebug("[Drag] Adding valid files:", { files: validFiles.map(f => f.name) });
          setPendingFiles((prev) => [...prev, ...validFiles]);
          setIsDiarizationModalOpen(true);
        }
      }
    };

    logger.uploadDebug("[Drag] Adding global document drag handlers");
    document.addEventListener('dragover', handleDocumentDragOver);
    document.addEventListener('dragleave', handleDocumentDragLeave);
    document.addEventListener('drop', handleDocumentDrop);

    return () => {
      logger.uploadDebug("[Drag] Removing global document drag handlers");
      document.removeEventListener('dragover', handleDocumentDragOver);
      document.removeEventListener('dragleave', handleDocumentDragLeave);
      document.removeEventListener('drop', handleDocumentDrop);
    };
  }, [currentView, setDraggingGlobal, setPendingFiles, setIsDiarizationModalOpen, validateModelSelection]);

  // Global drag & drop handlers for main element (only for transcription view)
  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (currentView !== "transcription") {
      logger.uploadDebug("[Drag] DragOver ignored - not on transcription view");
      return;
    }

    logger.uploadDebug("[Drag] DragOver triggered");

    // Check if files are being dragged
    if (e.dataTransfer.types.includes('Files')) {
      if (!isDraggingGlobal) {
        logger.uploadDebug("[Drag] Setting dragging state to true");
        setDraggingGlobal(true);
      }
    }
  }, [currentView, isDraggingGlobal, setDraggingGlobal]);

  const handleGlobalDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (currentView !== "transcription") return;

    logger.uploadDebug("[Drag] DragEnter triggered");

    if (e.dataTransfer.types.includes('Files')) {
      if (!isDraggingGlobal) {
        setDraggingGlobal(true);
      }
    }
  }, [currentView, isDraggingGlobal, setDraggingGlobal]);

  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Only hide if leaving the main container, not entering a child
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      logger.uploadDebug("[Drag] DragLeave triggered - leaving container");
      setDraggingGlobal(false);
    }
  }, [setDraggingGlobal]);

  const handleGlobalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    logger.uploadDebug("[Drag] Drop triggered");
    setDraggingGlobal(false);

    if (currentView !== "transcription") {
      logger.uploadDebug("[Drag] Drop ignored - not on transcription view");
      return;
    }

    logger.uploadDebug("[Drag] DataTransfer", {
      types: e.dataTransfer.types,
      itemsCount: e.dataTransfer.items.length,
      filesCount: e.dataTransfer.files.length
    });

    const files = Array.from(e.dataTransfer.files);
    logger.uploadInfo("Files dropped globally", { count: files.length });

    const validFiles: SelectedFile[] = [];
    const invalidFiles: string[] = [];

    files.forEach((file, index) => {
      logger.uploadDebug(`[Drag] File ${index}`, { name: file.name, type: file.type, size: file.size });
      if (isMediaFile(file.name)) {
        const filePath = (file as { path?: string }).path || file.name;
        validFiles.push({
          path: filePath,
          name: file.name,
          size: file.size,
        });
        logger.uploadDebug("Valid file", { fileName: file.name, size: file.size });
      } else {
        invalidFiles.push(file.name);
        logger.uploadWarn("Invalid file type", { fileName: file.name });
      }
    });

    if (invalidFiles.length > 0) {
      logger.uploadInfo("Some files were skipped", { invalidFiles, validCount: validFiles.length });
    }

    if (validFiles.length > 0) {
      // Check if transcription model is selected using validation hook
      if (!validateModelSelection()) {
        return;
      }

      logger.uploadInfo("Files added to selection", { count: validFiles.length, files: validFiles.map((f) => f.name) });
      setPendingFiles((prev) => [...prev, ...validFiles]);
      setIsDiarizationModalOpen(true);
    } else {
      logger.uploadDebug("[Drag] No valid files to add");
    }
  }, [currentView, setDraggingGlobal, validateModelSelection]);

  // Handle files selected from DropZone file dialog
  const handleFilesFromDialog = useCallback((files: Array<{ path: string; name: string; size: number }>) => {
    // Check if transcription model is selected using validation hook
    if (!validateModelSelection()) {
      return;
    }

    logger.uploadInfo("Files selected from dialog", { count: files.length, files: files.map((f) => f.name) });
    setPendingFiles((prev) => [...prev, ...files]);
    setIsDiarizationModalOpen(true);
  }, [validateModelSelection]);

  const getAvailableDiarizationProviders = (): DiarizationProvider[] => {
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
  };

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

  const handleModalConfirm = async (filesWithSettings: FileWithSettings[], _rememberChoice: boolean) => {
    // Validate all files before adding any
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

    // All validations passed, add tasks
    for (const file of filesWithSettings) {
      if (file.enableDiarization && file.diarizationProvider) {
        updateLastDiarizationProvider(file.diarizationProvider);
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
          onDragEnter={handleGlobalDragEnter}
          onDragOver={handleGlobalDragOver}
          onDragLeave={handleGlobalDragLeave}
          onDrop={handleGlobalDrop}
        >
          {/* Global drag overlay - shows when dragging over the whole app */}
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

          {/* Left panel - Task queue */}
          <div
            className={cn(
              "hidden lg:flex flex-col border-r transition-all duration-200 h-full",
              isSidebarCollapsed
                ? "w-12 p-2 items-center overflow-hidden"
                : "p-4 gap-4 overflow-hidden"
            )}
            style={{ width: isSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth }}
          >
            {/* Collapse/Expand button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className={cn(
                "w-11 h-11",
                !isSidebarCollapsed && "self-end"
              )}
              title={isSidebarCollapsed ? "Развернуть сайдбар" : "Свернуть сайдбар"}
            >
              {isSidebarCollapsed ? (
                <PanelLeftOpen className="h-8 w-8" />
              ) : (
                <PanelLeftClose className="h-8 w-8" />
              )}
            </Button>

            {isSidebarCollapsed ? (
              <>
                {/* Compact add button */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-11 h-11"
                  onClick={async () => {
                    // Check if transcription model is selected using validation hook
                    if (!validateModelSelection()) {
                      return;
                    }

                    const result = await selectMediaFiles();
                    if (result.success && result.data) {
                      const { addTask } = useTasks.getState();
                      const settings = useTasks.getState().settings;
                      for (const file of result.data) {
                        await addTask(file.path, file.name, file.size, {
                          model: settings.defaultModel as AIModel,
                          device: settings.defaultDevice as DeviceType,
                          language: settings.defaultLanguage as Language,
                          enableDiarization: settings.enableDiarization,
                          diarizationProvider: settings.diarizationProvider as DiarizationProvider,
                          numSpeakers: settings.numSpeakers,
                        });
                      }
                    }
                  }}
                  title="Добавить файлы"
                >
                  <Plus className="h-8 w-8" />
                </Button>

                {/* Archive button in compact mode */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-11 h-11"
                  onClick={() => useUIStore.getState().setCurrentView("archive")}
                  title="Архив"
                >
                  <Archive className="h-8 w-8" />
                </Button>

                {/* Compact TaskList */}
                <TaskList compact />
              </>
            ) : (
              <>
                <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-0">
                  {!selectedModel && (
                    <ModelWarning
                      onGoToModels={() => useUIStore.getState().setCurrentView("models")}
                    />
                  )}
                  {currentView === "transcription" && (
                    <>
                      <DropZone onFilesSelected={handleFilesFromDialog} />
                      <TaskList />
                    </>
                  )}
                  {currentView === "archive" && (
                    <div className="text-sm text-muted-foreground text-center py-4">
                      Выберите транскрипцию из архива
                    </div>
                  )}
                </div>
                {/* Archive button at bottom */}
                <Button
                  variant={currentView === "archive" ? "secondary" : "ghost"}
                  className={cn("w-full gap-2 justify-start shrink-0", currentView === "archive" && "bg-secondary")}
                  onClick={() => useUIStore.getState().setCurrentView("archive")}
                >
                  <Archive className="h-4 w-4" />
                  Архив
                </Button>
              </>
            )}
          </div>

          {/* Mobile view - no resize */}
          <div className="flex lg:hidden flex-col gap-4 border-b p-4 overflow-y-auto w-full">
            {currentView === "transcription" && (
              <>
                {!selectedModel && (
                  <ModelWarning
                    onGoToModels={() => useUIStore.getState().setCurrentView("models")}
                  />
                )}
                <DropZone onFilesSelected={handleFilesFromDialog} />
                <TaskList />
              </>
            )}
            {currentView === "archive" && (
              <div className="text-sm text-muted-foreground text-center py-4">
                Выберите транскрипцию из архива
              </div>
            )}
          </div>

          {/* Resize handle - only on desktop and when not collapsed */}
          {!isSidebarCollapsed && (
            <div
              className="hidden lg:block w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
              onMouseDown={handleResizeStart}
              title="Drag to resize"
            />
          )}

          {/* Right panel - Transcription view or Archive view */}
          <div className="flex-1 p-4 overflow-hidden min-h-0">
            {currentView === "archive" ? <ArchiveView /> : <TranscriptionView />}
          </div>
        </main>
      ) : (
        <main className="flex-1 overflow-hidden">
          <ModelsManagement />
        </main>
      )}

      <SettingsPanel />

      {/* Global Diarization Options Modal */}
      <DiarizationOptionsModal
        isOpen={isDiarizationModalOpen}
        onClose={() => {
          setIsDiarizationModalOpen(false);
          setPendingFiles([]);
        }}
        onConfirm={handleModalConfirm}
        files={pendingFiles}
        availableDiarizationProviders={getAvailableDiarizationProviders()}
        lastUsedProvider={diarizationProvider as DiarizationProvider}
      />

      {/* Error Dialog */}
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

/**
 * Root App component with Setup Wizard guard
 * Shows SetupWizard on first launch, then MainApplication
 */
function App() {
  const { initialize } = useSetupStore();
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize setup check on mount - run only ONCE
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

  // Show loading screen while checking setup status
  if (!isInitialized) {
    return <LoadingScreen />;
  }

  // Show SetupWizard or MainApplication based on setup completion
  return (
    <NotificationProvider>
      <SetupWizardGuard>
        <MainApplication />
      </SetupWizardGuard>
    </NotificationProvider>
  );
}

export default App;
