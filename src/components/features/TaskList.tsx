import React from "react";
import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  X,
  Archive,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { ProgressEnhanced } from "@/components/ui/progress-enhanced";
import { cn, formatFileSize, formatDateTime } from "@/lib/utils";
import { useTasks, useTasksByView, useUIStore } from "@/stores";
import type { TranscriptionTask, TaskStatus } from "@/types";

const statusConfig: Record<
  TaskStatus,
  { icon: React.ElementType; color: string; label: string }
> = {
  queued: {
    icon: Clock,
    color: "text-status-queued",
    label: "In queue",
  },
  processing: {
    icon: Loader2,
    color: "text-status-processing",
    label: "Processing",
  },
  completed: {
    icon: CheckCircle2,
    color: "text-status-completed",
    label: "Completed",
  },
  failed: {
    icon: XCircle,
    color: "text-status-failed",
    label: "Failed",
  },
  cancelled: {
    icon: X,
    color: "text-muted-foreground",
    label: "Cancelled",
  },
};

interface TaskItemProps {
  task: TranscriptionTask;
  compact?: boolean;
}

function TaskItem({ task, compact }: TaskItemProps) {
  const removeTask = useTasks((s) => s.removeTask);
  const cancelTask = useTasks((s) => s.cancelTask);
  const archiveTask = useTasks((s) => s.archiveTask);
  const { selectedTaskId, setSelectedTask } = useUIStore();

  const config = statusConfig[task.status];
  const StatusIcon = config.icon;
  const isSelected = selectedTaskId === task.id;

  if (compact) {
    return (
      <div
        className={cn(
          "cursor-pointer rounded-lg border p-2 transition-all hover:bg-muted group",
          isSelected && "border-primary bg-primary/10"
        )}
        onClick={() => setSelectedTask(task.id)}
        title={task.fileName}
      >
        {/* Status icon container */}
        <div className="relative w-full aspect-square flex items-center justify-center">
          {/* Status icon - centered */}
          {task.status === "processing" ? (
            <div className="relative">
              {/* Circular progress background - transparent */}
              <div className="w-10 h-10 rounded-full border-2 border-border/50 bg-transparent" />
              {/* Progress ring */}
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
              {/* Percentage */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[9px] font-bold text-foreground">
                  {Math.round(task.progress)}%
                </span>
              </div>
            </div>
          ) : task.status === "queued" ? (
            <div className="w-9 h-9 rounded-full border border-amber-500/50 flex items-center justify-center">
              <StatusIcon className="h-4 w-4 text-amber-500 animate-pulse" />
            </div>
          ) : task.status === "completed" ? (
            <div className="w-9 h-9 rounded-full border border-emerald-500/50 flex items-center justify-center">
              <StatusIcon className="h-4 w-4 text-emerald-500" />
            </div>
          ) : task.status === "failed" ? (
            <div className="w-9 h-9 rounded-full border border-red-500/50 flex items-center justify-center">
              <StatusIcon className="h-4 w-4 text-red-500" />
            </div>
          ) : (
            <div className="w-9 h-9 rounded-full border border-muted-foreground/40 flex items-center justify-center">
              <StatusIcon className={cn("h-4 w-4", config.color)} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        isSelected && "ring-2 ring-primary"
      )}
      onClick={() => setSelectedTask(task.id)}
    >
      <CardContent className="p-3 sm:p-4">
        {/* Верхняя строка: иконка, название, статус */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden">
            <p className="font-medium truncate text-sm" title={task.fileName}>{task.fileName}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(task.fileSize)} · {formatDateTime(task.createdAt)}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {task.status !== "completed" && (
              <div className={cn("flex items-center gap-1", config.color)} title={config.label}>
                <StatusIcon
                  className={cn(
                    "h-4 w-4 sm:h-5 sm:w-5",
                    task.status === "processing" && "animate-spin"
                  )}
                />
              </div>
            )}

            {task.status === "processing" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 sm:h-8 sm:w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelTask(task.id);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}

            {(task.status === "completed" || task.status === "failed" || task.status === "cancelled") && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    archiveTask(task.id);
                  }}
                  title="В архив"
                >
                  <Archive className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8"
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

        {/* Прогресс бар под текстом */}
        {task.status === "processing" && (
          <ProgressEnhanced
            value={task.progress}
            stage={task.stage === "downloading" ? "loading" : task.stage || "transcribing"}
            className="mt-2 h-1.5"
          />
        )}
      </CardContent>
    </Card>
  );
}

interface TaskListProps {
  compact?: boolean;
}

export function TaskList({ compact }: TaskListProps) {
  const tasks = useTasksByView("transcription");

  if (tasks.length === 0) {
    return null;
  }

  if (compact) {
    return (
      <div className="flex-1 w-full">
        <div className="text-[10px] text-center text-muted-foreground mb-1">
          {tasks.length}
        </div>
        <div className="space-y-1.5">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} compact />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Транскрипции ({tasks.length})</h2>
      </div>
      <div className="space-y-2">
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
