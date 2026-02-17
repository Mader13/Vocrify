import { useState, useCallback, useEffect, useRef } from "react";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { TaskList, ModelWarning } from "@/components/features";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTasks, useUIStore } from "@/stores";
import { selectMediaFiles } from "@/services/tauri";
import { useModelValidation } from "@/hooks";

const MIN_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_WIDTH = 460;
const DEFAULT_SIDEBAR_WIDTH = 336;
const COLLAPSED_SIDEBAR_WIDTH = 88;
const SIDEBAR_WIDTH_STORAGE_KEY = "vocrify-sidebar-width";

interface SidebarProps {
  onFilesSelected: (files: Array<{ path: string; name: string; size: number }>) => void;
}

export function Sidebar({ onFilesSelected }: SidebarProps) {
  const tasks = useTasks((s) => s.tasks);
  const isSidebarCollapsed = useUIStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { validateModelSelection, selectedModel } = useModelValidation();

  const visibleTasks = tasks.filter((task) => !task.archived);
  const queuedTasks = visibleTasks.filter((task) => task.status === "queued").length;
  const activeTasks = visibleTasks.filter((task) => task.status === "processing").length;
  const completedTasks = visibleTasks.filter((task) => task.status === "completed").length;

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const savedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    if (!Number.isFinite(savedWidth)) {
      return DEFAULT_SIDEBAR_WIDTH;
    }

    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, savedWidth));
  });
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));
      setSidebarWidth(clampedWidth);
    },
    [isResizing],
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", handleResize);
      window.addEventListener("mouseup", handleResizeEnd);
      return () => {
        window.removeEventListener("mousemove", handleResize);
        window.removeEventListener("mouseup", handleResizeEnd);
      };
    }
  }, [isResizing, handleResize, handleResizeEnd]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(
    () => () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    [],
  );

  const handleFilesSelected = useCallback(
    (files: Array<{ path: string; name: string; size: number }>) => {
      onFilesSelected(files);
    },
    [onFilesSelected],
  );
    
  const handleAddFiles = useCallback(async () => {
    if (!validateModelSelection()) {
      return;
    }

    const result = await selectMediaFiles();
    if (!result.success || !result.data || result.data.length === 0) {
      return;
    }

    const files = result.data
      .filter((metadata) => metadata.exists)
      .map((metadata) => ({
        path: metadata.path,
        name: metadata.name,
        size: metadata.size,
      }));

    if (files.length > 0) {
      handleFilesSelected(files);
    }
  }, [handleFilesSelected, validateModelSelection]);

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "group/sidebar hidden h-full shrink-0 border-r border-border/70 bg-background lg:flex",
          "transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isResizing && "select-none",
          isSidebarCollapsed ? "items-center" : "overflow-hidden"
        )}
        style={{ width: isSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth }}
      >
        <div className="relative flex h-full w-full flex-col">

          {/* Expanded content wrapper */}
          <div
            className={cn(
              "flex flex-1 flex-col min-h-0",
              isSidebarCollapsed ? "absolute inset-0" : ""
            )}
            style={{
              clipPath: isSidebarCollapsed ? "inset(0 100% 0 0)" : "inset(0 0 0 0)",
              transition: "clip-path 300ms cubic-bezier(0.4, 0, 0.2, 1)",
              willChange: "clip-path",
            }}
          >
            {/* Header with toggle and workspace in same row */}
            <div className="flex-none px-5 pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xl font-semibold tracking-tight">Workspace</p>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="h-11 w-11 shrink-0 rounded-xl border border-transparent transition-all duration-200 hover:border-border hover:bg-muted"
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  <PanelLeftClose className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Add files button */}
            <div className="flex-none px-5 py-4">
              <Button
                onClick={handleAddFiles}
                className="h-10 w-full justify-start gap-2 rounded-xl text-sm font-medium transition-all duration-200 hover:-translate-y-px"
              >
                <Plus className="h-4 w-4" />
                Add media files
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">
                Or simply drag & drop the file anywhere in the application window.
              </p>
            </div>

            {/* Task list */}
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-4">
              <div className="space-y-4">
                {!selectedModel && (
                  <ModelWarning
                    onGoToModels={() => useUIStore.getState().setCurrentView("models")}
                  />
                )}
                <TaskList
                  queuedCount={queuedTasks}
                  activeCount={activeTasks}
                  completedCount={completedTasks}
                />
              </div>
            </div>
          </div>

          {/* Collapsed compact content */}
          <div
            className={cn(
              "flex flex-1 flex-col items-center absolute inset-0",
              !isSidebarCollapsed ? "" : ""
            )}
            style={{
              clipPath: !isSidebarCollapsed ? "inset(0 100% 0 0)" : "inset(0 0 0 0)",
              transition: "clip-path 300ms cubic-bezier(0.4, 0, 0.2, 1)",
              willChange: "clip-path",
            }}
          >
            <div className="flex-none px-5 pt-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="h-11 w-11 shrink-0 rounded-xl border border-transparent transition-all duration-200 hover:border-border hover:bg-muted"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex-none px-5 py-4">
              <Button
                variant="default"
                size="icon"
                className="h-11 w-11 rounded-xl transition-all duration-200 hover:scale-[1.02]"
                onClick={handleAddFiles}
                title="Add files"
                aria-label="Add files"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </div>

            <div className="mt-3 mb-1 h-px w-8 bg-border" />

            <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden pr-px">
              <TaskList compact />
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full flex-col gap-4 border-b border-border/70 bg-background p-4 lg:hidden">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold tracking-tight">Workspace</p>
            <p className="text-xs text-muted-foreground">Manage uploads and queue</p>
            <p className="text-[11px] text-muted-foreground">
              Файлы можно перетаскивать прямо в окно приложения
            </p>
          </div>
          <Button onClick={handleAddFiles} size="sm" className="h-9 rounded-lg px-3">
            <Plus className="mr-1.5 h-4 w-4" />
            Add
          </Button>
        </div>

        {!selectedModel && (
          <ModelWarning onGoToModels={() => useUIStore.getState().setCurrentView("models")} />
        )}
        <TaskList
          queuedCount={queuedTasks}
          activeCount={activeTasks}
          completedCount={completedTasks}
        />
      </div>

      {!isSidebarCollapsed && (
        <div
          className={cn(
            "hidden w-2 cursor-col-resize lg:block",
            "transition-colors duration-200",
            isResizing ? "bg-foreground/20" : "hover:bg-foreground/10",
          )}
          onMouseDown={handleResizeStart}
          title="Drag to resize"
          aria-label="Resize sidebar"
        />
      )}
    </>
  );
}
