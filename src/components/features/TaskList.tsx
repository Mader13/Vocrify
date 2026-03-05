import {
  Clock,
  Clock3,
  Loader2,
  Check,
  AlertTriangle,
  Trash2,
  X,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn, formatFileSize, formatDateTime } from "@/lib/utils";
import { useTasks, useTasksByView, useUIStore } from "@/stores";
import { canArchiveTask } from "@/stores/utils/archive-eligibility";
import type { TranscriptionTask, TaskStatus } from "@/types";
import { useCallback, useEffect, useRef, useState, useId } from "react";
import { createPortal } from "react-dom";
import { ArchiveButton } from "./ArchiveButton";
import { DeleteTaskDialog } from "@/components/features/DeleteTaskDialog";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { useI18n } from "@/hooks";

const statusConfig: Record<
  TaskStatus,
  { icon: React.ElementType; borderColor: string; color: string; labelKey: string }
> = {
  queued: {
    icon: Clock,
    borderColor: "border-slate-400/50",
    color: "text-amber-500",
    labelKey: "taskList.inQueue",
  },
  processing: {
    icon: Loader2,
    borderColor: "border-blue-500/50",
    color: "text-blue-500",
    labelKey: "taskList.processing",
  },
  completed: {
    icon: Check,
    borderColor: "border-emerald-500/50",
    color: "text-emerald-500",
    labelKey: "taskList.completed",
  },
  failed: {
    icon: X,
    borderColor: "border-red-500/50",
    color: "text-red-500",
    labelKey: "taskList.failed",
  },
  cancelled: {
    icon: X,
    borderColor: "border-gray-400/50",
    color: "text-gray-500",
    labelKey: "taskList.cancelled",
  },
  interrupted: {
    icon: AlertTriangle,
    borderColor: "border-orange-500/50",
    color: "text-orange-500",
    labelKey: "taskList.interrupted",
  },
};

interface TaskItemTooltipProps {
  fileName: string;
  targetRef: React.RefObject<HTMLElement | null>;
}

function TaskItemTooltip({ fileName, targetRef }: TaskItemTooltipProps) {
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!targetRef.current) return;

    const updatePosition = () => {
      const target = targetRef.current;
      if (!target) {
        return;
      }

      const rect = target.getBoundingClientRect();
      setPosition({
        top: rect.top + rect.height / 2,
        left: rect.right,
      });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [targetRef]);

  if (!targetRef.current) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className="pointer-events-none fixed z-[100] max-w-[200px] truncate whitespace-nowrap rounded-md bg-popover/90 backdrop-blur-md px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-lg border border-border/50"
      style={{
        top: position.top,
        left: position.left,
        transform: "translateY(-50%)",
      }}
    >
      {fileName}
    </motion.div>,
    document.body
  );
}

interface TaskItemProps {
  task: TranscriptionTask;
  compact?: boolean;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  onRequestDelete: (task: TranscriptionTask) => void;
}

function TaskItem({ task, compact, onHoverStart, onHoverEnd, onRequestDelete }: TaskItemProps) {
  const { t } = useI18n();
  const cancelTask = useTasks((s) => s.cancelTask);
  const retryTask = useTasks((s) => s.retryTask);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const setCurrentView = useUIStore((s) => s.setCurrentView);

  const config = statusConfig[task.status];
  const StatusIcon = config.icon;
  const isSelected = selectedTaskId === task.id;

  const itemRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  const handleSelectTask = () => {
    setSelectedTask(task.id);
    setCurrentView("transcription");
  };

  const itemVariants = {
    hidden: { opacity: 0, y: -15, scale: 0.95 },
    visible: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, scale: 0.95, filter: "blur(4px)", transition: { duration: 0.2, ease: "easeOut" as const } },
  };

  return (
    <motion.div
      layout
      variants={itemVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={{
        layout: { type: "spring", bounce: 0, duration: 0.4 },
        opacity: { duration: 0.2 }
      }}
      className={cn(
        "relative group cursor-pointer overflow-hidden transition-[background-color,border-color,box-shadow] duration-300",
        compact 
          ? "flex items-center justify-center p-1.5 rounded-xl border-transparent"
          : "w-full rounded-xl border bg-card/40 backdrop-blur-md text-card-foreground shadow-sm hover:shadow-[0_4px_20px_-4px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_4px_20px_-4px_rgba(255,255,255,0.05)]",
        !compact && (isSelected ? "border-primary/50 bg-primary/5" : config.borderColor)
      )}
      onClick={handleSelectTask}
      onMouseEnter={() => {
        if (compact) {
          setShowTooltip(true);
          onHoverStart?.();
        }
      }}
      onMouseLeave={() => {
        if (compact) {
          setShowTooltip(false);
          onHoverEnd?.();
        }
      }}
      title={compact ? undefined : t(config.labelKey as Parameters<typeof t>[0])}
    >
      {/* Active Indicator */}
      {isSelected && (
        <motion.div 
          layoutId="unified-active-indicator"
          transition={{ type: "spring", bounce: 0, duration: 0.4 }}
          className={cn(
            "absolute bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)] z-20",
            compact ? "left-[3px] inset-y-1 my-auto h-7 w-1 rounded-full" : "left-0 top-0 bottom-0 w-1 rounded-l-xl shadow-[0_0_12px_rgba(var(--primary),0.8)]"
          )} 
        />
      )}

      {/* Hover backdrop for compact */}
      <AnimatePresence>
        {compact && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="absolute inset-x-2 inset-y-0.5 rounded-full bg-transparent group-hover:bg-white/5 dark:group-hover:bg-white/5 transition-colors duration-200 z-0" 
          />
        )}
      </AnimatePresence>
      
      {/* Background glow for expanded */}
      <AnimatePresence>
        {!compact && (
           <motion.div 
             initial={{ opacity: 0 }} 
             animate={{ opacity: 1 }} 
             exit={{ opacity: 0 }} 
             className="absolute inset-0 bg-gradient-to-tr from-transparent to-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-0" 
           />
        )}
      </AnimatePresence>

      <div ref={itemRef} className={cn("relative z-10 flex", compact ? "w-9 h-9 items-center justify-center shrink-0" : "flex-col w-full p-3 sm:p-4")}>
        <div className={cn("grid w-full", compact ? "block" : "grid-cols-[1fr_auto] gap-2 items-start")}>
          <div className={cn("flex items-center", compact ? "justify-center w-full h-full" : "min-w-0 overflow-hidden gap-3")}>
             
            {/* Status Icon (Shared) */}
            <motion.div layout className={cn("shrink-0", compact ? "w-9 h-9" : "w-10 h-10")}>
              {task.status === "processing" ? (
                <div className="relative flex items-center justify-center w-full h-full">
                  <div className="absolute inset-0 rounded-full border border-border/40 bg-transparent" />
                  <svg
                    className={cn("absolute inset-0 w-full h-full -rotate-90", !compact && "drop-shadow-[0_0_3px_rgba(var(--primary),0.5)]")}
                    viewBox="0 0 40 40"
                  >
                    <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-primary" strokeDasharray={`${task.progress * 1.13} 113`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                     <span className={cn("font-bold text-foreground", compact ? "text-[10px]" : "text-[11px]")}>{Math.round(task.progress)}%</span>
                  </div>
                </div>
              ) : (
                <div className={cn("w-full h-full rounded-full border flex items-center justify-center bg-background/50 backdrop-blur-sm", config.borderColor, !compact && "border-border/40")}>
                  <StatusIcon className={cn("h-4 w-4", config.color, task.status === 'queued' && "animate-pulse", !compact && "h-5 w-5")} />
                </div>
              )}
            </motion.div>

            {/* Expanded Text Content */}
            <AnimatePresence initial={false}>
              {!compact && (
                <motion.div 
                  initial={{ opacity: 0, width: 0 }} 
                  animate={{ opacity: 1, width: "auto" }} 
                  exit={{ opacity: 0, width: 0 }} 
                  className="min-w-0 flex-1 overflow-hidden whitespace-nowrap flex flex-col justify-center"
                >
                  <p className="font-medium truncate text-sm transition-colors group-hover:text-primary" title={task.fileName}>
                    {task.fileName}
                  </p>
                  <p className="text-xs text-muted-foreground/80 font-medium">
                    {formatFileSize(task.fileSize)}
                  </p>
                  <p className="text-xs text-muted-foreground/60 font-medium">
                    {formatDateTime(task.createdAt)}
                  </p>
                  {task.status === "queued" && (
                    <div className="mt-1.5 self-start inline-flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                      <Clock3 className="h-3 w-3" />
                      {t("taskList.inQueue")}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          {/* Action Buttons for Expanded */}
          <AnimatePresence>
            {!compact && (
              <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: "auto" }} exit={{ opacity: 0, width: 0 }} className="flex gap-1 items-start shrink-0 opacity-80 group-hover:opacity-100 transition-opacity whitespace-nowrap overflow-hidden">
                {task.status === "processing" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelTask(task.id);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}

                {task.status === "queued" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-full hover:bg-muted"
                      title={t("taskList.removeFromQueue")}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestDelete(task);
                      }}
                    >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}

                {(task.status === "cancelled" || task.status === "failed") && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-full hover:bg-primary/10 hover:text-primary"
                      title={t("taskList.retryTask")}
                      onClick={(e) => {
                        e.stopPropagation();
                        retryTask(task.id);
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
                      title={t("taskList.deleteTask")}
                       onClick={(e) => {
                         e.stopPropagation();
                         onRequestDelete(task);
                       }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}

                {canArchiveTask(task) && (
                  <div className="flex items-center gap-1">
                    <ArchiveButton task={task} iconOnly variant="action" title={t("taskList.archiveTask")} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
                       onClick={(e) => {
                         e.stopPropagation();
                         onRequestDelete(task);
                       }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
      </div>

      <AnimatePresence>
        {compact && showTooltip && (
          <TaskItemTooltip fileName={task.fileName} targetRef={itemRef} />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface TaskListProps {
  compact?: boolean;
}

export function TaskList({ compact }: TaskListProps) {
  const tasks = useTasksByView("transcription");
  const removeTask = useTasks((s) => s.removeTask);
  const [_hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [pendingDeleteTask, setPendingDeleteTask] = useState<TranscriptionTask | null>(null);
  const layoutIdPrefix = useId();

  const requestDeleteTask = useCallback((task: TranscriptionTask) => {
    setPendingDeleteTask(task);
  }, []);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setPendingDeleteTask(null);
    }
  }, []);

  const handleConfirmDeleteTask = useCallback(() => {
    if (!pendingDeleteTask) {
      return;
    }

    removeTask(pendingDeleteTask.id);
    setPendingDeleteTask(null);
  }, [pendingDeleteTask, removeTask]);

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className={cn("w-full min-w-0 transition-all duration-300", compact ? "flex-1" : "space-y-4")}>

      <motion.div 
        layout 
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.05 } }
        }}
        initial="hidden"
        animate="visible"
        className={cn("w-full min-w-0 transition-all duration-300", compact ? "space-y-2" : "space-y-3 pt-2 pb-16")}
      >
        <LayoutGroup id={layoutIdPrefix}>
          <AnimatePresence mode="popLayout">
            {tasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                compact={compact}
                onHoverStart={() => setHoveredTaskId(task.id)}
                onHoverEnd={() => setHoveredTaskId(null)}
                onRequestDelete={requestDeleteTask}
              />
            ))}
          </AnimatePresence>
        </LayoutGroup>
      </motion.div>
      <DeleteTaskDialog
        open={Boolean(pendingDeleteTask)}
        onOpenChange={handleDialogOpenChange}
        onConfirm={handleConfirmDeleteTask}
      />
    </div>
  );
}
