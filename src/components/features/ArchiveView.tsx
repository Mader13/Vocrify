import { useMemo } from "react";
import { Archive, FileVideo, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatFileSize } from "@/lib/utils";
import { useTasks, useUIStore } from "@/stores";
import type { TranscriptionTask, TaskStatus } from "@/types";

const statusConfig: Record<
  TaskStatus,
  { color: string; label: string }
> = {
  queued: {
    color: "text-status-queued",
    label: "В очереди",
  },
  processing: {
    color: "text-status-processing",
    label: "Обработка",
  },
  completed: {
    color: "text-status-completed",
    label: "Завершено",
  },
  failed: {
    color: "text-status-failed",
    label: "Ошибка",
  },
  cancelled: {
    color: "text-muted-foreground",
    label: "Отменено",
  },
};

interface ArchivedTaskItemProps {
  task: TranscriptionTask;
}

function ArchivedTaskItem({ task }: ArchivedTaskItemProps) {
  const removeTask = useTasks((s) => s.removeTask);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);

  const config = statusConfig[task.status];

  return (
    <Card
      className="cursor-pointer transition-all hover:shadow-md"
      onClick={() => setSelectedTask(task.id)}
    >
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <FileVideo className="h-8 w-8 sm:h-10 sm:w-10 text-muted-foreground shrink-0" />

          <div className="flex-1 min-w-0">
            <p className="font-medium truncate text-sm">{task.fileName}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(task.fileSize)} • {config.label}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 sm:h-8 sm:w-8"
              onClick={(e) => {
                e.stopPropagation();
                removeTask(task.id);
              }}
              title="Удалить"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ArchiveView() {
  const tasks = useTasks((state) => state.tasks);
  const archivedTasks = useMemo(() => tasks.filter((task) => task.archived), [tasks]);

  if (archivedTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Archive className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold mb-2">Архив пуст</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Архивированные транскрипции будут появляться здесь. Нажмите на иконку архива
          рядом с результатом транскрипции, чтобы переместить её в архив.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Архив ({archivedTasks.length})</h2>
      </div>
      <div className="space-y-2">
        {archivedTasks.map((task) => (
          <ArchivedTaskItem key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
