import React from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores";
import { selectMediaFiles } from "@/services/tauri";
import { logger } from "@/lib/logger";

interface DropZoneProps {
  className?: string;
  onFilesSelected?: (files: Array<{ path: string; name: string; size: number }>) => void;
}

export function DropZone({ className, onFilesSelected }: DropZoneProps) {
  const isDragging = useUIStore((s) => s.isDragging);

  const handleBrowseFiles = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    logger.uploadInfo("Opening file dialog");
    const result = await selectMediaFiles();
    if (result.success && result.data && result.data.length > 0) {
      const validFiles = result.data
        .filter((metadata) => metadata.exists)
        .map((metadata) => ({
          path: metadata.path,
          name: metadata.name,
          size: metadata.size,
        }));
      
      logger.uploadInfo("Files selected", { count: validFiles.length, files: validFiles.map((f) => f.name) });
      
      if (validFiles.length > 0 && onFilesSelected) {
        onFilesSelected(validFiles);
      }
    } else {
      logger.uploadDebug("No files selected", { success: result.success });
    }
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Drop Zone */}
      <div
        onClick={handleBrowseFiles}
        className={cn(
          "group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 sm:p-6 lg:p-8 transition-all duration-200 cursor-pointer overflow-hidden",
          isDragging
            ? "border-primary bg-primary/10 scale-[1.02]"
            : "border-muted-foreground/20 bg-muted/30 hover:border-muted-foreground/40 hover:bg-muted/50"
        )}
      >
        {/* Background animation on drag */}
        <div
          className={cn(
            "absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent transition-opacity duration-300",
            isDragging ? "opacity-100" : "opacity-0"
          )}
        />

        {/* Icon with animation */}
        <div
          className={cn(
            "relative mb-3 sm:mb-4 rounded-full bg-background p-3 sm:p-4 shadow-sm transition-transform duration-300",
            isDragging ? "scale-110" : "group-hover:scale-105"
          )}
        >
          <Upload
            className={cn(
              "h-6 w-6 sm:h-8 sm:w-8 transition-colors duration-200",
              isDragging ? "text-primary" : "text-muted-foreground"
            )}
          />
        </div>

        {/* Text content */}
        <div className="relative text-center">
          <p className="mb-1 text-sm sm:text-base font-medium">
            {isDragging ? (
              <span className="text-primary">Drop files here</span>
            ) : (
              <span className="hidden sm:inline">Drag & drop media files</span>
            )}
            {!isDragging && (
              <span className="sm:hidden">Tap to browse</span>
            )}
          </p>
          <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">
            or click to browse
          </p>
        </div>

        {/* Supported formats hint */}
        <div className="relative mt-3 sm:mt-4 flex flex-wrap justify-center gap-1 sm:gap-1.5 max-w-[200px] sm:max-w-none">
          {["MP4", "MKV", "AVI", "MOV", "MP3", "WAV", "FLAC"].map((format) => (
            <span
              key={format}
              className="rounded bg-muted px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs text-muted-foreground"
            >
              {format}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
