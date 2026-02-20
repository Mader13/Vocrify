import { useState } from "react";
import { createPortal } from "react-dom";
import { Archive, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTasks } from "@/stores";
import type { TranscriptionTask, ArchiveMode, ArchiveCompression } from "@/types";
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

  const handleArchive = async (mode: ArchiveMode, compression?: ArchiveCompression) => {
    setIsArchiving(true);
    try {
      await archiveTaskWithMode(task.id, mode, compression);

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
          "inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/70",
          "h-8 text-xs font-medium text-muted-foreground opacity-70 sm:h-9",
          iconOnly ? "w-8 px-0 sm:w-9" : "px-2.5 sm:px-3"
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
          "inline-flex items-center justify-center rounded-lg border border-border/70 transition-colors duration-150",
          iconOnly ? "h-8 w-8 sm:h-9 sm:w-9" : "h-8 gap-1.5 px-2.5 text-xs font-medium sm:h-9 sm:px-3",
          "text-foreground hover:bg-muted/70",
          isArchiving && "opacity-50 cursor-not-allowed"
        )}
      >
        {isArchiving ? (
          <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
        {!iconOnly && <span className="hidden lg:inline">Archive</span>}
      </button>
      {createPortal(
        <ArchiveModal
          task={task}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onArchive={handleArchive}
          isLoading={isArchiving}
          defaultMode={archiveSettings.defaultMode}
          defaultCompression={archiveSettings.compression}
          showFileSizes={archiveSettings.showFileSizes}
        />,
        document.body
      )}
    </>
  );
}
