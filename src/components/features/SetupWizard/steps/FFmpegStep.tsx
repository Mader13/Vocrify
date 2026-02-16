import { useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckCard, CheckItem } from "../CheckCard";
import { useSetupStore } from "@/stores/setupStore";

/**
 * Step 2: FFmpeg Installation Check
 * Verifies FFmpeg is installed and accessible.
 */
export function FFmpegStep() {
  const { ffmpegCheck, checkFFmpeg, isChecking } = useSetupStore();

  useEffect(() => {
    if (!ffmpegCheck) {
      void checkFFmpeg();
    }
  }, [ffmpegCheck, checkFFmpeg]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">FFmpeg</h3>
        <p className="text-sm text-muted-foreground mt-1">
          FFmpeg is required for audio/video preprocessing.
        </p>
      </div>

      <CheckCard
        title="FFmpeg"
        status={ffmpegCheck?.status ?? "pending"}
        message={ffmpegCheck?.message ?? "Checking FFmpeg..."}
        onRetry={checkFFmpeg}
      >
        {ffmpegCheck && (
          <div className="space-y-1">
            <CheckItem
              label={
                ffmpegCheck.installed
                  ? `FFmpeg ${ffmpegCheck.version ?? "installed"}`
                  : "FFmpeg not found"
              }
              sublabel={ffmpegCheck.path ?? undefined}
              status={ffmpegCheck.installed ? "ok" : "error"}
            />
          </div>
        )}
      </CheckCard>

      {ffmpegCheck?.status === "error" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
          <h4 className="font-medium text-red-600 dark:text-red-400">
            FFmpeg installation required
          </h4>
          <div className="text-sm space-y-2 text-muted-foreground">
            <p>Install FFmpeg and ensure it is available in PATH.</p>

            <div className="space-y-2">
              <p className="font-medium text-foreground">Windows:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>
                  Download from{" "}
                  <a
                    href="https://ffmpeg.org/download.html"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    ffmpeg.org/download
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Extract to a folder (e.g. `C:\\ffmpeg`).</li>
                <li>Add `C:\\ffmpeg\\bin` to `PATH`.</li>
              </ol>
            </div>

            <div className="space-y-2">
              <p className="font-medium text-foreground">macOS (Homebrew):</p>
              <div className="bg-muted rounded-md p-3 font-mono text-xs">
                <code>brew install ffmpeg</code>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-medium text-foreground">Linux (Ubuntu/Debian):</p>
              <div className="bg-muted rounded-md p-3 font-mono text-xs">
                <code>sudo apt install ffmpeg</code>
              </div>
            </div>
          </div>
        </div>
      )}

      {isChecking && !ffmpegCheck && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-pulse text-muted-foreground">Checking FFmpeg...</div>
        </div>
      )}
    </div>
  );
}

export interface FFmpegStepFooterProps {
  onBack: () => void;
  onNext: () => void;
}

export function FFmpegStepFooter({ onBack, onNext }: FFmpegStepFooterProps) {
  const { ffmpegCheck, checkFFmpeg, isChecking } = useSetupStore();

  const hasError = ffmpegCheck?.status === "error";
  const canProceed = Boolean(ffmpegCheck?.installed && ffmpegCheck.status !== "error");

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        {hasError && (
          <Button variant="outline" onClick={() => void checkFFmpeg()} disabled={isChecking}>
            Retry
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onNext} disabled={isChecking || !canProceed}>
          Continue
        </Button>
      </div>
    </div>
  );
}
