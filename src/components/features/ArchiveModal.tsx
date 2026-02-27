import { useState, useEffect } from "react";
import { useI18n } from "@/hooks";
import { FileVideo, Music, FileText, Info, Archive, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { TranscriptionTask, ArchiveMode, ArchiveCompression } from "@/types";
import { ARCHIVE_COMPRESSION_LABELS } from "@/types";
import { getFileSize } from "@/services/tauri";
import { formatFileSize } from "@/lib/utils";

interface ArchiveModalProps {
  task: TranscriptionTask;
  isOpen: boolean;
  onClose: () => void;
  onArchive: (mode: ArchiveMode, compression?: ArchiveCompression) => Promise<void>;
  isLoading: boolean;
  defaultMode?: ArchiveMode;
  defaultCompression?: ArchiveCompression;
  showFileSizes?: boolean;
}



export function ArchiveModal({
  task,
  isOpen,
  onClose,
  onArchive,
  isLoading,
  defaultMode = "delete_video",
  defaultCompression = "none",
  showFileSizes = true,
}: ArchiveModalProps) {
  const { t } = useI18n();
  const [selectedMode, setSelectedMode] = useState<ArchiveMode>(defaultMode);
  const [selectedCompression, setSelectedCompression] = useState<ArchiveCompression>(defaultCompression);
  const [fileSize, setFileSize] = useState<number | null>(null);

  const ARCHIVE_OPTIONS: { mode: ArchiveMode; label: string; description: string }[] = [
    {
      mode: "keep_all",
      label: t("archiveModal.keepAll"),
      description: t("archiveModal.keepAllDesc"),
    },
    {
      mode: "delete_video",
      label: t("archiveModal.deleteVideo"),
      description: t("archiveModal.deleteVideoDesc"),
    },
    {
      mode: "text_only",
      label: t("archiveModal.textOnly"),
      description: t("archiveModal.textOnlyDesc"),
    },
  ];

  const COMPRESSION_OPTIONS: { value: ArchiveCompression; label: string; desc: string }[] = [
    { value: "none", label: t("archiveModal.noCompression"), desc: t("archiveModal.maxQuality") },
    { value: "light", label: t("archiveModal.light"), desc: t("archiveModal.lightDesc") },
    { value: "medium", label: t("archiveModal.medium"), desc: t("archiveModal.mediumDesc") },
    { value: "heavy", label: t("archiveModal.heavy"), desc: t("archiveModal.heavyDesc") },
  ];

  useEffect(() => {
    if (isOpen) {
      setSelectedMode(defaultMode);
      setSelectedCompression(defaultCompression);
    }
  }, [isOpen, defaultMode, defaultCompression]);

  useEffect(() => {
    if (isOpen && task.filePath && showFileSizes) {
      getFileSize(task.filePath)
        .then((result) => {
          if (result.success && result.data) {
            setFileSize(result.data);
          } else {
            setFileSize(null);
          }
        })
        .catch(() => setFileSize(null));
    }
  }, [isOpen, task.filePath, showFileSizes]);

  const compressionRatios: Record<ArchiveCompression, number> = {
    none: 0,
    light: 0.3,
    medium: 0.5,
    heavy: 0.7,
  };

  const estimatedSavings =
    fileSize && showFileSizes
      ? selectedMode === "keep_all"
        ? Math.round(fileSize * compressionRatios[selectedCompression])
        : selectedMode === "delete_video"
        ? Math.round(fileSize * 0.95)
        : fileSize
      : null;

  const handleSubmit = () => {
    onArchive(selectedMode, selectedCompression);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            {t("archiveModal.archiving")} {task.fileName}
          </DialogTitle>
          <DialogDescription>
            {t("archiveModal.chooseAction")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {fileSize && showFileSizes && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Info className="h-4 w-4" />
                {t("archiveModal.fileSize")}
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("archiveModal.video")}</span>
                <span>{formatFileSize(fileSize)}</span>
              </div>
              {estimatedSavings !== null && estimatedSavings > 0 && (
                <div className="flex justify-between text-sm font-medium text-green-600 border-t pt-2 mt-2">
                  <span>{t("archiveModal.spaceSaved")}</span>
                  <span>~{formatFileSize(estimatedSavings)}</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">{t("archiveModal.mediaAction")}</label>
            <div className="space-y-2">
              {ARCHIVE_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  onClick={() => setSelectedMode(option.mode)}
                  className={cn(
                    "w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all",
                    selectedMode === option.mode
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/30"
                  )}
                >
                  <div
                    className={cn(
                      "p-2 rounded-md shrink-0",
                      selectedMode === option.mode ? "bg-primary/10" : "bg-muted"
                    )}
                  >
                    {option.mode === "keep_all" && <FileVideo className="h-4 w-4" />}
                    {option.mode === "delete_video" && <Music className="h-4 w-4" />}
                    {option.mode === "text_only" && <FileText className="h-4 w-4" />}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{option.label}</div>
                    <div className="text-xs text-muted-foreground">{option.description}</div>
                  </div>
                  {selectedMode === option.mode && (
                    <div className="h-2 w-2 rounded-full bg-primary shrink-0 mt-2" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {selectedMode === "keep_all" && (
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4" />
                {t("archiveModal.compression")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {COMPRESSION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSelectedCompression(option.value)}
                    className={cn(
                      "flex items-center gap-2 p-2 rounded-lg border text-left transition-all text-sm",
                      selectedCompression === option.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/30"
                    )}
                  >
                    <div
                      className={cn(
                        "h-3 w-3 rounded-full border-2 shrink-0",
                        selectedCompression === option.value
                          ? "border-primary bg-primary"
                          : "border-muted-foreground"
                      )}
                    />
                    <div className="flex-1 text-left">
                      <div className="font-medium text-xs">{option.label}</div>
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {ARCHIVE_COMPRESSION_LABELS[selectedCompression]}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-md hover:bg-muted transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground",
              "hover:bg-primary/90 transition-colors flex items-center gap-2",
              isLoading && "opacity-50 cursor-not-allowed"
            )}
          >
            {isLoading ? (
              <>
                <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                {t("archiveModal.archivingProgress")}
              </>
            ) : (
              <>
                <Archive className="h-4 w-4" />
                {t("archive.archiveAction")}
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
