import { useState } from "react";
import { Archive, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTasks } from "@/stores";
import type { TranscriptionTask, ArchiveMode } from "@/types";
import { ArchiveModal } from "./ArchiveModal";
import { notifySuccess } from "@/services/notifications";

interface ArchiveButtonProps {
  task: TranscriptionTask;
  iconOnly?: boolean;
}

export function ArchiveButton({ task, iconOnly = false }: ArchiveButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const archiveTaskWithMode = useTasks((s) => s.archiveTaskWithMode);
  const archiveSettings = useTasks((s) => s.archiveSettings);

  const isArchived = task.archived;

  const handleArchive = async (mode: ArchiveMode) => {
    setIsArchiving(true);
    try {
      await archiveTaskWithMode(task.id, mode);

      notifySuccess(
        "Archived",
        `Video "${task.fileName}" has been moved to archive`
      );
    } catch (error) {
      console.error("Archive failed:", error);
    } finally {
      setIsArchiving(false);
      setIsModalOpen(false);
    }
  };

  if (isArchived) {
    return (
      <button
        disabled
        className={cn(
          "h-8 rounded-md flex items-center justify-center gap-1.5",
          "bg-muted/50 text-muted-foreground cursor-not-allowed",
          iconOnly ? "w-8 px-0" : "px-2 text-xs font-medium"
        )}
      >
        <Check className="h-4 w-4" />
        {!iconOnly && <span>Archived</span>}
      </button>
    );
  }

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        disabled={isArchiving}
        className={cn(
          "h-8 rounded-md transition-all duration-150 flex items-center justify-center",
          iconOnly ? "w-8 px-0" : "px-2 gap-1.5 text-xs font-medium",
          "hover:bg-muted/60 active:bg-muted/80 text-muted-foreground hover:text-foreground",
          isArchiving && "opacity-50 cursor-not-allowed"
        )}
      >
        {isArchiving ? (
          <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
        {!iconOnly && <span>Archive</span>}
      </button>
      <ArchiveModal
        task={task}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onArchive={handleArchive}
        isLoading={isArchiving}
        defaultMode={archiveSettings.defaultMode}
        showFileSizes={archiveSettings.showFileSizes}
      />
    </>
  );
}
