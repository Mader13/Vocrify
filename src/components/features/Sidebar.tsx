import { useState, useCallback, useEffect, useRef } from "react";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { DropZone, TaskList, ModelWarning } from "@/components/features";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTasks, useUIStore } from "@/stores";
import { selectMediaFiles } from "@/services/tauri";
import { useModelValidation } from "@/hooks";
import type { AIModel, DeviceType, Language, DiarizationProvider } from "@/types";

const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 320;
const COLLAPSED_SIDEBAR_WIDTH = 72;

interface SidebarProps {
  onFilesSelected: (files: Array<{ path: string; name: string; size: number }>) => void;
}

export function Sidebar({ onFilesSelected }: SidebarProps) {
  const isSidebarCollapsed = useUIStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { validateModelSelection, selectedModel } = useModelValidation();

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    if (!isResizing || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const newWidth = e.clientX - rect.left;
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

  const handleAddFiles = useCallback(async () => {
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
  }, [validateModelSelection]);

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "hidden lg:flex flex-col border-r transition-all duration-200 h-full",
          isSidebarCollapsed
            ? "w-12 p-2 items-center overflow-hidden"
            : "p-4 gap-4 overflow-hidden px-5"
        )}
        style={{ width: isSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth }}
      >
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
            <Button
              variant="ghost"
              size="icon"
              className="w-11 h-11"
              onClick={handleAddFiles}
              title="Добавить файлы"
            >
              <Plus className="h-8 w-8" />
            </Button>
            <TaskList compact />
          </>
        ) : (
          <div className="flex-1 flex flex-col gap-4 overflow-y-auto overflow-x-visible min-h-0 px-1">
            {!selectedModel && (
              <ModelWarning
                onGoToModels={() => useUIStore.getState().setCurrentView("models")}
              />
            )}
            <DropZone onFilesSelected={onFilesSelected} />
            <TaskList />
          </div>
        )}
      </div>

      <div className="flex lg:hidden flex-col gap-4 border-b p-4 overflow-y-auto w-full">
        {!selectedModel && (
          <ModelWarning
            onGoToModels={() => useUIStore.getState().setCurrentView("models")}
          />
        )}
        <DropZone onFilesSelected={onFilesSelected} />
        <TaskList />
      </div>

      {!isSidebarCollapsed && (
        <div
          className="hidden lg:block w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        />
      )}
    </>
  );
}
