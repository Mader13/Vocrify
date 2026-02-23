import { useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

export function useDropZone({ currentView, onFilesDropped }: UseDropZoneOptions) {
  const isDraggingGlobal = useUIStore((s) => s.isDragging);
  const setDraggingGlobal = useUIStore((s) => s.setDragging);
  const { validateModelSelection } = useModelValidation();
  const isDropEnabled = currentView === "transcription" || currentView === "archive";

  const processFiles = useCallback(
    (files: SelectedFile[], source: "document" | "tauri") => {
      if (!isDropEnabled) {
        logger.uploadDebug("[Drag] Drop ignored - drop is disabled for current view", { currentView, source });
        return;
      }

      const validFiles = files.filter((file) => isMediaFile(file.name || file.path));

      if (validFiles.length === 0) {
        logger.uploadDebug("[Drag] No valid media files found", { source, total: files.length });
        return;
      }

      if (!validateModelSelection()) {
        return;
      }

      logger.uploadInfo("Files dropped", {
        source,
        count: validFiles.length,
        files: validFiles.map((f) => f.name),
      });

      onFilesDropped(validFiles);
    },
    [isDropEnabled, currentView, validateModelSelection, onFilesDropped],
  );

  // Tauri native - only source for handling actual file drops
  // Document-level handlers removed - they duplicate Tauri native and cause triple processing
  useEffect(() => {
    if (!isDropEnabled) return;

    let unlistenNativeDrop: (() => void) | undefined;

    const setupNativeDrop = async () => {
      try {
        const window = getCurrentWindow();
        unlistenNativeDrop = await window.onDragDropEvent((event) => {
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

            const droppedFiles: SelectedFile[] = event.payload.paths.map((path) => {
              const fileName = path.split(/[/\\]/).pop() || path;
              return {
                path,
                name: fileName,
                size: 0,
              };
            });

            processFiles(droppedFiles, "tauri");
          }
        });

        logger.uploadDebug("[Drag] Native Tauri drop listener attached");
      } catch (error) {
        logger.uploadWarn("[Drag] Failed to attach native Tauri drop listener", { error: String(error) });
      }
    };

    setupNativeDrop();

    return () => {
      if (unlistenNativeDrop) {
        unlistenNativeDrop();
      }
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
