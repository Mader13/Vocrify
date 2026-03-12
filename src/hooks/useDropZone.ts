import { useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getFilesMetadata } from "@/services/tauri";
import { useUIStore } from "@/stores";
import { logger } from "@/lib/logger";
import { isMediaFile } from "@/lib/utils";
import { useModelValidation } from "@/hooks/useModelValidation";

interface SelectedFile {
  path: string;
  name: string;
  size: number;
}

interface UseDropZoneOptions {
  currentView: string;
  onFilesDropped: (files: SelectedFile[]) => void;
}

function mapDroppedPaths(paths: string[]): SelectedFile[] {
  return paths.map((path) => ({
    path,
    name: path.split(/[/\\]/).pop() || path,
    size: 0,
  }));
}

async function hydrateDroppedFiles(paths: string[]): Promise<SelectedFile[]> {
  const fallbackFiles = mapDroppedPaths(paths);
  const metadataResult = await getFilesMetadata(paths);

  if (!metadataResult.success || !metadataResult.data) {
    logger.uploadWarn("[Drag] Failed to read dropped file metadata", {
      error: metadataResult.error,
      paths,
    });
    return fallbackFiles;
  }

  return metadataResult.data
    .filter((file) => file.exists)
    .map((file) => ({ path: file.path, name: file.name, size: file.size }));
}

export function useDropZone({ currentView, onFilesDropped }: UseDropZoneOptions) {
  const isDraggingGlobal = useUIStore((s) => s.isDragging);
  const setDraggingGlobal = useUIStore((s) => s.setDragging);
  const { validateModelSelection } = useModelValidation();
  const isDropEnabled = currentView === "transcription" || currentView === "archive";
  const currentViewRef = useRef(currentView);
  const onFilesDroppedRef = useRef(onFilesDropped);
  const validateModelSelectionRef = useRef(validateModelSelection);

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  useEffect(() => {
    onFilesDroppedRef.current = onFilesDropped;
  }, [onFilesDropped]);

  useEffect(() => {
    validateModelSelectionRef.current = validateModelSelection;
  }, [validateModelSelection]);

  const processFiles = useCallback(
    (files: SelectedFile[], source: "document" | "tauri") => {
      const activeView = currentViewRef.current;
      const dropEnabled = activeView === "transcription" || activeView === "archive";

      if (!dropEnabled) {
        logger.uploadDebug("[Drag] Drop ignored - drop is disabled for current view", { currentView: activeView, source });
        return;
      }

      const validFiles = files.filter((file) => isMediaFile(file.name || file.path));

      if (validFiles.length === 0) {
        logger.uploadDebug("[Drag] No valid media files found", { source, total: files.length });
        return;
      }

      if (!validateModelSelectionRef.current()) {
        return;
      }

      logger.uploadInfo("Files dropped", {
        source,
        count: validFiles.length,
        files: validFiles.map((f) => f.name),
      });

      onFilesDroppedRef.current(validFiles);
    },
    [],
  );

  // Tauri native - only source for handling actual file drops
  // Document-level handlers removed - they duplicate Tauri native and cause triple processing
  useEffect(() => {
    if (!isDropEnabled) return;

    let isDisposed = false;
    let unlistenNativeDrop: (() => void) | null = null;

    const setupNativeDrop = async () => {
      try {
        const window = getCurrentWindow();
        const unlisten = await window.onDragDropEvent((event) => {
          if (event.payload.type === "enter" || event.payload.type === "over") {
            setDraggingGlobal(true);
            return;
          }

          if (event.payload.type === "leave") {
            setDraggingGlobal(false);
            return;
          }

          if (event.payload.type === "drop") {
            setDraggingGlobal(false);
            void hydrateDroppedFiles(event.payload.paths).then((droppedFiles) => {
              if (isDisposed) {
                return;
              }

              processFiles(droppedFiles, "tauri");
            });
          }
        });

        if (isDisposed) {
          unlisten();
          return;
        }

        unlistenNativeDrop = unlisten;

        logger.uploadDebug("[Drag] Native Tauri drop listener attached");
      } catch (error) {
        logger.uploadWarn("[Drag] Failed to attach native Tauri drop listener", { error: String(error) });
      }
    };

    void setupNativeDrop();

    return () => {
      isDisposed = true;
      unlistenNativeDrop?.();
    };
  }, [isDropEnabled, processFiles, setDraggingGlobal]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isDropEnabled) {
      logger.uploadDebug("[Drag] DragOver ignored - drop is disabled for current view", { currentView });
      return;
    }

    logger.uploadDebug("[Drag] DragOver triggered");

    if (e.dataTransfer.types.includes('Files')) {
      if (!isDraggingGlobal) {
        logger.uploadDebug("[Drag] Setting dragging state to true");
        setDraggingGlobal(true);
      }
    }
  }, [isDropEnabled, currentView, isDraggingGlobal, setDraggingGlobal]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isDropEnabled) return;

    logger.uploadDebug("[Drag] DragEnter triggered");

    if (e.dataTransfer.types.includes('Files')) {
      if (!isDraggingGlobal) {
        setDraggingGlobal(true);
      }
    }
  }, [isDropEnabled, isDraggingGlobal, setDraggingGlobal]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      logger.uploadDebug("[Drag] DragLeave triggered - leaving container");
      setDraggingGlobal(false);
    }
  }, [setDraggingGlobal]);

  // React handler for visual feedback only - actual file processing via Tauri native
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    logger.uploadDebug("[Drag] React Drop triggered (visual reset only)");
    setDraggingGlobal(false);
    // Note: Actual file processing happens in Tauri native handler
    // This prevents duplicate processing when both handlers fire
  }, [setDraggingGlobal]);

  return {
    isDraggingGlobal,
    dragHandlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
