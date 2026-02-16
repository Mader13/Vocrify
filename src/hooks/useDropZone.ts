import { useEffect, useCallback } from "react";
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
          if (!validateModelSelection()) {
            return;
          }
          logger.uploadDebug("[Drag] Adding valid files:", { files: validFiles.map(f => f.name) });
          onFilesDropped(validFiles);
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
  }, [currentView, setDraggingGlobal, onFilesDropped, validateModelSelection]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (currentView !== "transcription") {
      logger.uploadDebug("[Drag] DragOver ignored - not on transcription view");
      return;
    }

    logger.uploadDebug("[Drag] DragOver triggered");

    if (e.dataTransfer.types.includes('Files')) {
      if (!isDraggingGlobal) {
        logger.uploadDebug("[Drag] Setting dragging state to true");
        setDraggingGlobal(true);
      }
    }
  }, [currentView, isDraggingGlobal, setDraggingGlobal]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
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

  const handleDrop = useCallback((e: React.DragEvent) => {
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
      if (!validateModelSelection()) {
        return;
      }

      logger.uploadInfo("Files added to selection", { count: validFiles.length, files: validFiles.map((f) => f.name) });
      onFilesDropped(validFiles);
    } else {
      logger.uploadDebug("[Drag] No valid files to add");
    }
  }, [currentView, setDraggingGlobal, validateModelSelection, onFilesDropped]);

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
