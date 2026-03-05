import { useState } from "react";
import { useI18n } from "@/hooks";
import { createPortal } from "react-dom";
import { Archive, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTasks } from "@/stores";
import { canArchiveTask } from "@/stores/utils/archive-eligibility";
import type { TranscriptionTask, ArchiveMode, ArchiveCompression } from "@/types";
import { ArchiveModal } from "./ArchiveModal";
import { notifySuccess } from "@/services/notifications";

interface ArchiveButtonProps {
  task: TranscriptionTask;
  iconOnly?: boolean;
  variant?: "default" | "action";
  title?: string;
}

export function ArchiveButton({ task, iconOnly = false, variant = "default", title }: ArchiveButtonProps) {
  const { t } = useI18n();
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
        t("archive.archived"),
        `Video "${task.fileName}" has been moved to archive`
      );
    } catch (error) {
      console.error("Archive failed:", error);
    } finally {
      setIsArchiving(false);
      setIsModalOpen(false);
    }
  };

  const isActionVariant = variant === "action";

  if (isArchived) {
    return (
      <button
        disabled
        className={cn(
          "inline-flex items-center justify-center transition-colors duration-150",
          isActionVariant
            ? "rounded-full h-7 w-7 sm:h-8 sm:w-8 shrink-0 p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary"
            : "rounded-lg border border-border/70 h-8 text-xs font-medium text-muted-foreground opacity-70 sm:h-9",
          iconOnly
            ? (isActionVariant ? "" : "w-8 px-0 sm:w-9")
            : (isActionVariant ? "px-2.5 gap-1.5" : "px-2.5 sm:px-3 gap-1.5")
        )}
        title={title || t("archive.archived")}
      >
        <Check className={isActionVariant ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {!iconOnly && <span>{t("archive.archived")}</span>}
      </button>
    );
  }

  if (!canArchiveTask(task)) {
    return null;
  }

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        disabled={isArchiving}
        className={cn(
          "inline-flex items-center justify-center transition-colors duration-150",
          isActionVariant
            ? "rounded-full h-7 w-7 sm:h-8 sm:w-8 shrink-0 text-foreground hover:bg-primary/10 hover:text-primary"
            : "rounded-lg border border-border/70 h-8 text-xs font-medium text-foreground hover:bg-primary/10 hover:text-primary sm:h-9",
          iconOnly
            ? (isActionVariant ? "" : "w-8 px-0 sm:w-9")
            : (isActionVariant ? "px-2.5 gap-1.5" : "px-2.5 sm:px-3 gap-1.5"),
          isArchiving && "opacity-50 cursor-not-allowed"
        )}
        title={title || (iconOnly ? t("archive.archiveAction") : undefined)}
      >
        {isArchiving ? (
          <div className={cn("border-2 border-current border-t-transparent rounded-full animate-spin", isActionVariant ? "h-3.5 w-3.5" : "h-4 w-4")} />
        ) : (
          <Archive className={isActionVariant ? "h-3.5 w-3.5" : "h-4 w-4"} />
        )}
        {!iconOnly && <span className="hidden lg:inline">{t("archive.archiveAction")}</span>}
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
