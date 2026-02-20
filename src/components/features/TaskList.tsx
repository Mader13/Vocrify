import {
  Clock,
  Clock3,
  Loader2,
  Check,
  AlertTriangle,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ProgressEnhanced } from "@/components/ui/progress-enhanced";
import { cn, formatFileSize, formatDateTime } from "@/lib/utils";
import { useTasks, useTasksByView, useUIStore } from "@/stores";
import { canArchiveTask } from "@/stores/utils/archive-eligibility";
import type { TranscriptionTask, TaskStatus } from "@/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArchiveButton } from "./ArchiveButton";

const statusConfig: Record<
  TaskStatus,
  { icon: React.ElementType; borderColor: string; color: string; label: string }
> = {
  queued: {
    icon: Clock,
    borderColor: "border-slate-400",
    color: "text-amber-500",
    label: "In queue",
  },
  processing: {
    icon: Loader2,
    borderColor: "border-blue-500",
    color: "text-blue-500",
    label: "Processing",
  },
  completed: {
    icon: Check,
    borderColor: "border-emerald-500",
    color: "text-emerald-500",
    label: "Completed",
  },
  failed: {
    icon: X,
    borderColor: "border-red-500",
    color: "text-red-500",
    label: "Failed",
  },
  cancelled: {
    icon: X,
    borderColor: "border-gray-400",
    color: "text-gray-500",
    label: "Cancelled",
  },
  interrupted: {
    icon: AlertTriangle,
    borderColor: "border-orange-500",
    color: "text-orange-500",
    label: "Interrupted",
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
    <div
      className="pointer-events-none fixed z-[100] max-w-[200px] truncate whitespace-nowrap rounded-md bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md border border-border/50"
      style={{
        top: position.top,
        left: position.left,
        transform: "translateY(-50%)",
      }}
    >
      {fileName}
    </div>,
    document.body
  );
}

interface TaskItemProps {
  task: TranscriptionTask;
  compact?: boolean;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}

function TaskItem({ task, compact, onHoverStart, onHoverEnd }: TaskItemProps) {
  const removeTask = useTasks((s) => s.removeTask);
  const cancelTask = useTasks((s) => s.cancelTask);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);

  const config = statusConfig[task.status];
  const StatusIcon = config.icon;
  const isSelected = selectedTaskId === task.id;

  const itemRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  if (compact) {
    return (
      <>
        <div
          ref={itemRef}
          className="group cursor-pointer rounded-lg p-2 transition-all hover:bg-muted relative"
          onClick={() => setSelectedTask(task.id)}
          onMouseEnter={() => {
            setShowTooltip(true);
            onHoverStart?.();
          }}
          onMouseLeave={() => {
            setShowTooltip(false);
            onHoverEnd?.();
          }}
        >
          {isSelected && (
            <div className="absolute left-0 top-2 bottom-2 w-1 bg-primary rounded-full" />
          )}
          <div className="relative w-full aspect-square flex items-center justify-center">
            {task.status === "processing" ? (
              <div className="relative">
                <div className="w-10 h-10 rounded-full border-2 border-border/50 bg-transparent" />
                <svg
                  className="absolute inset-0 w-10 h-10 -rotate-90"
                  viewBox="0 0 40 40"
                >
                  <circle
                    cx="20"
                    cy="20"
                    r="17"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="text-primary"
                    strokeDasharray={`${task.progress * 1.07} 107`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-foreground">
                    {Math.round(task.progress)}%
                  </span>
                </div>
              </div>
            ) : task.status === "queued" ? (
              <div className={cn("w-9 h-9 rounded-full border-2 flex items-center justify-center", config.borderColor)}>
                <StatusIcon className={cn("h-4 w-4 animate-pulse", config.color)} />
              </div>
            ) : task.status === "completed" ? (
              <div className={cn("w-9 h-9 rounded-full border-2 flex items-center justify-center", config.borderColor)}>
                <StatusIcon className={cn("h-4 w-4", config.color)} />
              </div>
            ) : task.status === "failed" || task.status === "interrupted" ? (
              <div className={cn("w-9 h-9 rounded-full border-2 flex items-center justify-center", config.borderColor)}>
                <StatusIcon className={cn("h-4 w-4", config.color)} />
              </div>
            ) : (
              <div className={cn("w-9 h-9 rounded-full border-2 flex items-center justify-center", config.borderColor)}>
                <StatusIcon className={cn("h-4 w-4", config.color)} />
              </div>
            )}
          </div>
        </div>
        {showTooltip && (
          <TaskItemTooltip fileName={task.fileName} targetRef={itemRef} />
        )}
      </>
    );
  }

  return (
    <div
      className={cn(
        "w-full rounded-lg border-2 bg-card text-card-foreground shadow-sm cursor-pointer transition-all hover:shadow-md overflow-hidden relative",
        config.borderColor
      )}
      onClick={() => setSelectedTask(task.id)}
      title={config.label}
    >
      {isSelected && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
      )}
      <div className="p-3 sm:p-4">
        <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
          <div className="min-w-0 overflow-hidden">
            <p className="font-medium truncate text-sm" title={task.fileName}>
              {task.fileName}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(task.fileSize)} · {formatDateTime(task.createdAt)}
            </p>
            {task.status === "queued" && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                <Clock3 className="h-3 w-3" />
                In queue
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {task.status === "processing" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8 shrink-0"
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
                className="h-7 w-7 sm:h-8 sm:w-8 shrink-0"
                title="Remove from queue"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTask(task.id);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}

            {canArchiveTask(task) && (
              <>
                <ArchiveButton task={task} iconOnly />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTask(task.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        </div>

        {task.status === "processing" && (
          <ProgressEnhanced
            value={task.progress}
            stage={task.stage === "downloading" ? "loading" : task.stage || "transcribing"}
            className="mt-2 h-1.5"
          />
        )}
      </div>
    </div>
  );
}

interface TaskListProps {
  compact?: boolean;
  queuedCount?: number;
  activeCount?: number;
  completedCount?: number;
}

export function TaskList({ compact, queuedCount, activeCount, completedCount }: TaskListProps) {
  const tasks = useTasksByView("transcription");
  const [_hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

  if (tasks.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <div className="flex-1 w-full min-w-0">
        <div className="text-[10px] text-center text-muted-foreground mb-1">
          {tasks.length}
        </div>
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              compact
              onHoverStart={() => setHoveredTaskId(task.id)}
              onHoverEnd={() => setHoveredTaskId(null)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3 min-w-0">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Transcriptions ({tasks.length})</h2>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center rounded-md border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Queue {queuedCount}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          <span className={cn("h-1.5 w-1.5 rounded-full", activeCount && activeCount > 0 ? "bg-primary" : "bg-muted-foreground/40")} />
          Running {activeCount}
        </span>
        <span className="inline-flex items-center rounded-md border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Done {completedCount}
        </span>
      </div>
      <div className="w-full space-y-2 min-w-0">
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
