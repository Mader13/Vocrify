import * as React from "react";
import { Download, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import {
  getFFmpegStatus,
  downloadFFmpeg,
  onFFmpegProgress,
  onFFmpegStatus,
  type FFmpegStatus,
  type FFmpegProgress,
  type FFmpegStatusEvent,
} from "@/services/tauri";

export function FFmpegDownloader() {
  const [status, setStatus] = React.useState<FFmpegStatus | null>(null);
  const [progress, setProgress] = React.useState<FFmpegProgress | null>(null);
  const [showDialog, setShowDialog] = React.useState(false);

  const checkFFmpeg = React.useCallback(async () => {
    try {
      logger.debug("Checking FFmpeg status");
      const result = await getFFmpegStatus();
      logger.debug("FFmpeg status result", result);

      if (result.success && result.data) {
        logger.debug("Setting FFmpeg status", { tag: result.data.tag });
        setStatus(result.data);
        if (result.data.tag === "NotInstalled") {
          logger.info("FFmpeg not installed, showing dialog");
          setShowDialog(true);
        }
      } else {
        logger.warn("Unknown FFmpeg status, showing dialog");
        setStatus({ tag: "NotInstalled" });
        setShowDialog(true);
      }
    } catch (error) {
      logger.error("Failed to check FFmpeg status", { error: String(error) });
      setStatus({ tag: "NotInstalled" });
    }
  }, []);

  const handleStatusUpdate = React.useCallback((payload: FFmpegStatusEvent) => {
    logger.debug("FFmpeg status update", payload);

    switch (payload.status) {
      case "downloading":
        logger.info("FFmpeg downloading");
        setStatus({ tag: "Downloading" });
        break;
      case "extracting":
        logger.info("FFmpeg extracting");
        setStatus({ tag: "Extracting" });
        break;
      case "completed":
        logger.info("FFmpeg download completed");
        setStatus({ tag: "Completed" });
        setTimeout(() => {
          setShowDialog(false);
          checkFFmpeg();
        }, 2000);
        break;
      case "failed":
        logger.error("FFmpeg download failed", { message: payload.message });
        setStatus({ tag: "Failed", error: payload.message });
        break;
      default:
        logger.warn("Unknown FFmpeg status", { status: payload.status });
    }
  }, [checkFFmpeg]);

  React.useEffect(() => {
    logger.info("FFmpegDownloader initializing");

    checkFFmpeg();

    const unlistenProgress = onFFmpegProgress((progressData) => {
      logger.debug("FFmpeg progress event", progressData);
      setProgress(progressData);
    });

    const unlistenStatus = onFFmpegStatus((statusEvent) => {
      logger.debug("FFmpeg status event", statusEvent);
      handleStatusUpdate(statusEvent);
    });

    return () => {
      logger.debug("FFmpegDownloader cleaning up listeners");
      unlistenProgress.then((f) => f?.());
      unlistenStatus.then((f) => f?.());
    };
  }, [checkFFmpeg, handleStatusUpdate]);

  const handleDownload = async () => {
    try {
      logger.info("Starting FFmpeg download");
      setStatus({ tag: "Downloading" });
      setProgress(null);
      const result = await downloadFFmpeg();
      if (!result.success) {
        setStatus({ tag: "Failed", error: result.error || "Download failed" });
      }
      logger.info("FFmpeg download initiated");
    } catch (error) {
      logger.error("FFmpeg download failed", { error: String(error) });
      setStatus({ tag: "Failed", error: String(error) });
    }
  };

  const closeDialog = () => {
    setShowDialog(false);
  };

  if (!showDialog) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                FFmpeg Required
              </h2>
              <p className="text-gray-600 dark:text-gray-300 text-sm">
                FFmpeg is required for video/audio processing but is not installed on your system.
              </p>
            </div>
            <button
              onClick={closeDialog}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X size={20} />
            </button>
          </div>

          {status?.tag === "NotInstalled" && (
            <button
              onClick={handleDownload}
              className={cn(
                "w-full flex items-center justify-center gap-2",
                "bg-blue-600 hover:bg-blue-700 text-white",
                "py-3 px-4 rounded-lg font-medium",
                "transition-colors duration-200"
              )}
            >
              <Download size={20} />
              <span>Download FFmpeg</span>
            </button>
          )}

          {status?.tag === "Downloading" && progress && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-700 dark:text-gray-200">Downloading...</span>
                <span className="font-medium text-blue-600 dark:text-blue-400">
                  {progress.percent.toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                {(progress.currentBytes / (1024 * 1024)).toFixed(1)} MB /{" "}
                {(progress.totalBytes / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
          )}

          {status?.tag === "Extracting" && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
              <p className="text-gray-700 dark:text-gray-200">Extracting FFmpeg...</p>
            </div>
          )}

          {status?.tag === "Completed" && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 mb-3">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-gray-700 dark:text-gray-200 font-medium">FFmpeg installed successfully!</p>
              <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                You can now transcribe video and audio files.
              </p>
            </div>
          )}

          {status?.tag === "Failed" && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-200 text-sm font-medium mb-3">
                Failed to install FFmpeg
              </p>
              <p className="text-red-700 dark:text-red-300 text-sm">
                {status.error}
              </p>
              <button
                onClick={() => {
                  setStatus(null);
                  handleDownload();
                }}
                className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors duration-200"
              >
                Retry Download
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
