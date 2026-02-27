import { useCallback } from "react";
import { TaskList, ModelWarning, SidebarToggle, AddFilesButton } from "@/components/features";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores";
import { selectMediaFiles } from "@/services/tauri";
import { useNotificationStore } from "@/services/notifications";
import { useModelValidation, useResizable, useI18n } from "@/hooks";
import { motion, AnimatePresence } from "framer-motion";

const MIN_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_WIDTH = 460;
const DEFAULT_SIDEBAR_WIDTH = 336;
const COLLAPSED_SIDEBAR_WIDTH = 88;
const SIDEBAR_WIDTH_STORAGE_KEY = "vocrify-sidebar-width";

interface SidebarProps {
  onFilesSelected: (files: Array<{ path: string; name: string; size: number }>) => void;
}

export function Sidebar({ onFilesSelected }: SidebarProps) {
  const isSidebarCollapsed = useUIStore((s) => s.isSidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { validateModelSelection, selectedModel } = useModelValidation();
  const { t } = useI18n();

  const { width: sidebarWidth, isResizing, containerRef, handleResizeStart } = useResizable({
    initialWidth: DEFAULT_SIDEBAR_WIDTH,
    minWidth: MIN_SIDEBAR_WIDTH,
    maxWidth: MAX_SIDEBAR_WIDTH,
    storageKey: SIDEBAR_WIDTH_STORAGE_KEY,
  });


  const handleFilesSelected = useCallback(
    (files: Array<{ path: string; name: string; size: number }>) => {
      onFilesSelected(files);
    },
    [onFilesSelected],
  );

  const handleAddFiles = useCallback(async () => {
    if (!validateModelSelection()) {
      useNotificationStore.getState().addNotification({
        title: t("sidebar.noModelTitle"),
        message: t("sidebar.noModelMessage"),
        type: "warning",
      });
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
  }, [handleFilesSelected, validateModelSelection, t]);

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "group/sidebar hidden shrink-0 lg:flex flex-col",
          "bg-background/60 backdrop-blur-xl border border-border/50 shadow-2xl rounded-2xl lg:rounded-3xl overflow-hidden relative z-0",
          "transition-[width,background-color] duration-300 ease-[cubic-bezier(0.4,0,0,2,1)]",
          isResizing && "select-none bg-background/80"
        )}
        style={{ width: isSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : sidebarWidth }}
      >
        <div className="relative flex h-full w-full flex-col min-h-0">
          <div className={cn("flex-none pt-4 transition-all duration-300", isSidebarCollapsed ? "px-2 pb-2" : "px-5 pb-4")}>
            <div className={cn("flex items-center", isSidebarCollapsed ? "justify-center" : "justify-between")}>
              <AnimatePresence initial={false} mode="wait">
                {!isSidebarCollapsed && (
                  <motion.p 
                    key="workspace-title"
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-xl font-semibold tracking-tight text-foreground/90 whitespace-nowrap overflow-hidden pr-2"
                  >
                    {t("sidebar.workspace")}
                  </motion.p>
                )}
              </AnimatePresence>
              <SidebarToggle isCollapsed={isSidebarCollapsed} onToggle={toggleSidebar} />
            </div>
          </div>

          <div className={cn("flex-none transition-all duration-300 flex flex-col items-center", isSidebarCollapsed ? "px-2 py-2" : "px-5 py-2")}>
            <AddFilesButton onClick={handleAddFiles} variant="default" isCollapsed={isSidebarCollapsed} />
            <AnimatePresence initial={false}>
              {!isSidebarCollapsed && (
                <motion.p 
                  initial={{ opacity: 0, height: 0, marginTop: 0 }}
                  animate={{ opacity: 1, height: "auto", marginTop: 8 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-xs text-muted-foreground/80 leading-relaxed font-medium text-center overflow-hidden"
                >
                  {t("sidebar.dragAndDropHint")}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <AnimatePresence initial={false}>
            {isSidebarCollapsed && (
              <motion.div 
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 8 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className="flex justify-center flex-none mt-2"
              >
                <div className="h-px w-8 bg-border/40" />
              </motion.div>
            )}
          </AnimatePresence>

          <div className={cn("min-h-0 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar transition-all duration-300", isSidebarCollapsed ? "px-2" : "px-5 pb-4")}>
            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {!isSidebarCollapsed && !selectedModel && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <ModelWarning onGoToModels={() => useUIStore.getState().setCurrentView("models")} />
                  </motion.div>
                )}
              </AnimatePresence>
              <TaskList
                compact={isSidebarCollapsed}
              />
            </div>
          </div>
        </div>

        {/* Interactive Resizer Handle */}
        {!isSidebarCollapsed && (
          <div
            className={cn(
              "hidden lg:flex w-4 cursor-col-resize absolute -right-2 top-0 bottom-0 z-50 group items-center justify-center",
            )}
            onMouseDown={handleResizeStart}
            title={t("sidebar.dragToResize")}
            aria-label={t("sidebar.resizeSidebar")}
          >
            <div className={cn(
              "h-16 w-1 rounded-full transition-all duration-300",
              isResizing ? "bg-primary w-1.5" : "bg-border/40 group-hover:bg-primary/50 group-hover:w-1.5"
            )} />
          </div>
        )}
      </div>

      <div className="flex w-full flex-col gap-4 border border-border/50 bg-background/60 backdrop-blur-xl shadow-xl rounded-2xl p-4 lg:hidden relative z-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground/90">{t("sidebar.workspace")}</p>
            <p className="text-[11px] text-muted-foreground/80 font-medium">
                {t("sidebar.dragAndDropCompact")}
            </p>
          </div>
          <AddFilesButton onClick={handleAddFiles} variant="mobile" />
        </div>

        {!selectedModel && (
          <ModelWarning onGoToModels={() => useUIStore.getState().setCurrentView("models")} />
        )}
        <TaskList />
      </div>

    </>
  );
}
