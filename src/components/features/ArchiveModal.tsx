import { useState, useEffect } from "react";
import { FileVideo, Music, FileText, Info, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { TranscriptionTask, ArchiveMode } from "@/types";
import { getFileSize } from "@/services/tauri";
import { formatFileSize } from "@/lib/utils";

interface ArchiveModalProps {
  task: TranscriptionTask;
  isOpen: boolean;
  onClose: () => void;
  onArchive: (mode: ArchiveMode) => Promise<void>;
  isLoading: boolean;
  defaultMode?: ArchiveMode;
  showFileSizes?: boolean;
}

const ARCHIVE_OPTIONS: { mode: ArchiveMode; label: string; description: string }[] = [
  {
    mode: "keep_all",
    label: "Keep All",
    description: "Keep video and audio",
  },
  {
    mode: "delete_video",
    label: "Delete Video",
    description: "Delete video, keep audio and transcription",
  },
  {
    mode: "text_only",
    label: "Text Only",
    description: "Delete video and audio, keep only transcription",
  },
];

export function ArchiveModal({
  task,
  isOpen,
  onClose,
  onArchive,
  isLoading,
  defaultMode = "delete_video",
  showFileSizes = true,
}: ArchiveModalProps) {
  const [selectedMode, setSelectedMode] = useState<ArchiveMode>(defaultMode);
  const [fileSize, setFileSize] = useState<number | null>(null);

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

  const estimatedSavings =
    fileSize && showFileSizes
      ? selectedMode === "keep_all"
        ? 0
        : selectedMode === "delete_video"
        ? Math.round(fileSize * 0.95)
        : fileSize
      : null;

  const handleSubmit = () => {
    onArchive(selectedMode);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            Archiving: {task.fileName}
          </DialogTitle>
          <DialogDescription>
            Choose what to do with media files when archiving
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {fileSize && showFileSizes && (
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Info className="h-4 w-4" />
                File size
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Video:</span>
                <span>{formatFileSize(fileSize)}</span>
              </div>
              {selectedMode !== "keep_all" && estimatedSavings !== null && (
                <div className="flex justify-between text-sm font-medium text-green-600 border-t pt-2 mt-2">
                  <span>Space to be freed:</span>
                  <span>~{formatFileSize(estimatedSavings)}</span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">What to do with media files:</label>
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
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-md hover:bg-muted transition-colors"
          >
            Cancel
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
                Archiving...
              </>
            ) : (
              <>
                <Archive className="h-4 w-4" />
                Archive
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
