import * as React from "react";
import {
  Download,
  FileText,
  Subtitles,
  FileJson,
  FileType,
  Type,
  Clock,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { selectExportPath, exportTranscription } from "@/services/tauri";
import { logger } from "@/lib/logger";
import type { TranscriptionTask, ExportFormat, ExportMode } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface ExportMenuProps {
  task: TranscriptionTask;
  iconOnly?: boolean;
}

interface ExportFormatConfig {
  value: ExportFormat;
  label: string;
  description: string;
  icon: React.ReactNode;
  supportsPlainText: boolean;
}

const EXPORT_FORMATS: ExportFormatConfig[] = [
  {
    value: "txt",
    label: "Plain Text",
    description: "Plain text file",
    icon: <FileType className="h-5 w-5" />,
    supportsPlainText: true,
  },
  {
    value: "md",
    label: "Markdown",
    description: "Markdown markup language",
    icon: <FileText className="h-5 w-5" />,
    supportsPlainText: true,
  },
  {
    value: "srt",
    label: "SubRip (SRT)",
    description: "Subtitle format",
    icon: <Subtitles className="h-5 w-5" />,
    supportsPlainText: false,
  },
  {
    value: "vtt",
    label: "WebVTT",
    description: "Web video subtitle format",
    icon: <Subtitles className="h-5 w-5" />,
    supportsPlainText: false,
  },
  {
    value: "json",
    label: "JSON",
    description: "Structured data",
    icon: <FileJson className="h-5 w-5" />,
    supportsPlainText: false,
  },
];

const LOCAL_STORAGE_KEY = "transcription-export-mode";
const LOCAL_STORAGE_FORMAT_KEY = "transcription-export-format";

/**
 * ExportMenu - Modal dialog for exporting transcriptions
 * Opens a centered modal with format selection and export mode toggle
 */
export function ExportMenu({ task, iconOnly = false }: ExportMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportStatus, setExportStatus] = React.useState<{
    type: "success" | "error" | null;
    message: string;
  }>({ type: null, message: "" });

  const [selectedFormat, setSelectedFormat] = React.useState<ExportFormat>(
    () => {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem(LOCAL_STORAGE_FORMAT_KEY);
        if (saved && EXPORT_FORMATS.some((f) => f.value === saved)) {
          return saved as ExportFormat;
        }
      }
      return "txt";
    },
  );

  const [exportMode, setExportMode] = React.useState<ExportMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved === "plain_text" || saved === "with_timestamps") {
        return saved;
      }
    }
    return "with_timestamps";
  });

  const selectedFormatConfig = EXPORT_FORMATS.find(
    (f) => f.value === selectedFormat,
  );
  const supportsPlainText = selectedFormatConfig?.supportsPlainText ?? false;

  // Save preferences to localStorage
  React.useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_FORMAT_KEY, selectedFormat);
  }, [selectedFormat]);

  React.useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, exportMode);
  }, [exportMode]);

  // Clear status after 3 seconds
  React.useEffect(() => {
    if (exportStatus.type) {
      const timer = setTimeout(() => {
        setExportStatus({ type: null, message: "" });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [exportStatus]);

  /**
   * Handles export to file using Tauri native dialog
   */
  const handleExport = async () => {
    if (!task.result) {
      setExportStatus({
        type: "error",
        message: "No transcription data to export",
      });
      return;
    }

    setIsExporting(true);
    logger.info(`Starting export to ${selectedFormat} format`, {
      taskId: task.id,
      format: selectedFormat,
      exportMode,
    });

    try {
      // Generate default filename
      const defaultName = `${task.fileName}.${selectedFormat}`;

      // Show native save dialog
      const result = await selectExportPath(defaultName, selectedFormat);

      if (!result.success) {
        throw new Error(result.error || "Failed to open save dialog");
      }

      // User cancelled the dialog
      if (!result.data) {
        logger.info("Export cancelled by user", { taskId: task.id });
        setIsExporting(false);
        return;
      }

      const outputPath = result.data;

      // Export the transcription with export mode
      const exportResult = await exportTranscription(
        task.result,
        selectedFormat,
        outputPath,
        exportMode,
      );

      if (!exportResult.success) {
        throw new Error(exportResult.error || "Failed to export transcription");
      }

      logger.info(`Export completed successfully`, {
        taskId: task.id,
        format: selectedFormat,
        path: outputPath,
      });

      setExportStatus({
        type: "success",
        message: `Exported to ${selectedFormat.toUpperCase()} successfully`,
      });

      // Close modal on success after a short delay
      setTimeout(() => {
        setIsOpen(false);
      }, 500);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logger.error(`Export failed`, {
        taskId: task.id,
        format: selectedFormat,
        error: errorMessage,
      });
      setExportStatus({
        type: "error",
        message: `Export error: ${errorMessage}`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (!task.result) {
    return null;
  }

  return (
    <>
      {/* Export Button */}
      <button
        onClick={() => setIsOpen(true)}
        disabled={isExporting}
        title="Export"
        className={cn(
          "h-8 rounded-md transition-all duration-150 flex items-center justify-center",
          iconOnly ? "w-8 px-0" : "px-2 gap-1.5 text-xs font-medium",
          "hover:bg-muted/60 active:bg-muted/80 text-muted-foreground hover:text-foreground",
          isExporting && "opacity-50 cursor-not-allowed",
        )}
      >
        {isExporting ? (
          <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : exportStatus.type === "success" ? (
          <Download className="h-4 w-4 text-green-500" />
        ) : exportStatus.type === "error" ? (
          <X className="h-4 w-4 text-red-500" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {!iconOnly && (
          <span className="hidden sm:inline">
            {isExporting ? "Exporting..." : "Export"}
          </span>
        )}
      </button>

      {/* Export Modal */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Transcription</DialogTitle>
            <DialogDescription>
              Select the format and export options for your transcription
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Format Selection */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Export Format</label>
              <div className="grid grid-cols-1 gap-2">
                {EXPORT_FORMATS.map((format) => (
                  <button
                    key={format.value}
                    onClick={() => setSelectedFormat(format.value)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all",
                      selectedFormat === format.value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border hover:border-muted-foreground/30 hover:bg-muted/50",
                    )}
                  >
                    <div
                      className={cn(
                        "p-2 rounded-md",
                        selectedFormat === format.value
                          ? "bg-primary/10"
                          : "bg-muted",
                      )}
                    >
                      {format.icon}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-sm">{format.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {format.description}
                      </div>
                    </div>
                    {selectedFormat === format.value && (
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Export Mode Toggle - only for formats that support it */}
            {supportsPlainText && (
              <div className="space-y-3">
                <label className="text-sm font-medium">Text Format</label>
                <div className="flex gap-2 p-1 bg-muted rounded-lg">
                  <button
                    onClick={() => setExportMode("with_timestamps")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md transition-all",
                      exportMode === "with_timestamps"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Clock className="h-4 w-4" />
                    <span>With Timestamps</span>
                  </button>
                  <button
                    onClick={() => setExportMode("plain_text")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md transition-all",
                      exportMode === "plain_text"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Type className="h-4 w-4" />
                    <span>Plain Text Only</span>
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {exportMode === "plain_text"
                    ? "Exports as continuous text without timestamps or speaker labels"
                    : "Includes timestamps and speaker labels (if multiple speakers detected)"}
                </p>
              </div>
            )}

            {/* Preview of what will be exported */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Preview
              </label>
              <div className="p-3 bg-muted rounded-lg text-xs text-muted-foreground font-mono">
                {selectedFormat === "txt" && exportMode === "plain_text" && (
                  <span>
                    Hello world this is a sample transcription text...
                  </span>
                )}
                {selectedFormat === "txt" &&
                  exportMode === "with_timestamps" && (
                    <span>
                      [00:01:23] Hello world
                      <br />
                      [00:01:25] This is a sample...
                    </span>
                  )}
                {selectedFormat === "md" && exportMode === "plain_text" && (
                  <span>
                    Hello world this is a sample transcription text...
                  </span>
                )}
                {selectedFormat === "md" &&
                  exportMode === "with_timestamps" && (
                    <span>
                      **[00:01:23]** Hello world
                      <br />
                      **[00:01:25]** This is...
                    </span>
                  )}
                {(selectedFormat === "srt" || selectedFormat === "vtt") && (
                  <span>
                    1<br />
                    00:00:01,000 --&gt; 00:00:05,000
                    <br />
                    Hello world
                  </span>
                )}
                {selectedFormat === "json" && (
                  <span>
                    {"{"} segments: [...], language: "en" {"}"}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Footer with Export Button */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <button
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 text-sm font-medium rounded-md hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground",
                "hover:bg-primary/90 transition-colors flex items-center gap-2",
                isExporting && "opacity-50 cursor-not-allowed",
              )}
            >
              {isExporting ? (
                <>
                  <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Export as {selectedFormat.toUpperCase()}
                </>
              )}
            </button>
          </div>

          {/* Status Message */}
          {exportStatus.type && (
            <div
              className={cn(
                "mt-4 px-4 py-2 text-sm rounded-md text-center",
                exportStatus.type === "success"
                  ? "bg-green-500/10 text-green-600 border border-green-500/20"
                  : "bg-red-500/10 text-red-600 border border-red-500/20",
              )}
            >
              {exportStatus.message}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
