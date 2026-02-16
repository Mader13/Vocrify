import { useState, useMemo } from "react";
import { Trash2, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTasks } from "@/stores";
import type { TranscriptionTask } from "@/types";
import { deleteFile } from "@/services/tauri";
import { logger } from "@/lib/logger";

interface ArchiveCleanupModalProps {
  tasks: TranscriptionTask[];
  isOpen: boolean;
  onClose: () => void;
}

export function ArchiveCleanupModal({
  tasks,
  isOpen,
  onClose,
}: ArchiveCleanupModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const tasksWithFiles = useMemo(
    () => tasks.filter((t) => !t.videoDeleted || t.audioPath),
    [tasks]
  );

  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const selectAll = () => {
    setSelectedIds(new Set(tasksWithFiles.map((t) => t.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      for (const taskId of selectedIds) {
        const task = tasks.find((t) => t.id === taskId);
        if (task) {
          if (task.audioPath) {
            const result = await deleteFile(task.audioPath);
            if (result.success) {
              const updatedTasks = useTasks.getState().tasks;
              const updatedTask = updatedTasks.find((t) => t.id === taskId);
              if (updatedTask) {
                useTasks.getState().upsertTask({
                  ...updatedTask,
                  audioPath: undefined,
                });
              }
            }
          }
        }
      }
      logger.transcriptionInfo("Archive cleanup completed", {
        deletedCount: selectedIds.size,
      });
      setSelectedIds(new Set());
      onClose();
    } catch (error) {
      logger.error("Archive cleanup failed", { error: String(error) });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Очистка архива
          </DialogTitle>
          <DialogDescription>
            Освободите место, удалив медиафайлы из архивных задач
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex justify-between text-sm">
              <span>Выбрано задач:</span>
              <span className="font-medium">
                {selectedIds.size} из {tasksWithFiles.length}
              </span>
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-2 border rounded-lg p-2">
            {tasksWithFiles.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">
                Нет задач с медиафайлами для очистки
              </p>
            ) : (
              tasksWithFiles.map((task) => (
                <label
                  key={task.id}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors",
                    selectedIds.has(task.id) && "bg-primary/5"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(task.id)}
                    onChange={() => toggleSelect(task.id)}
                    className="rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {task.fileName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {task.archiveMode === "text_only"
                        ? "Только текст"
                        : task.videoDeleted
                        ? "Аудио сохранено"
                        : "Видео и аудио"}
                    </div>
                  </div>
                </label>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={selectAll}>
              Выбрать все
            </Button>
            <Button variant="outline" size="sm" onClick={deselectAll}>
              Снять выбор
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            onClick={handleDelete}
            disabled={selectedIds.size === 0 || isDeleting}
            className="gap-2"
          >
            {isDeleting ? (
              <>
                <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Удаление...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Удалить выбранные
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
