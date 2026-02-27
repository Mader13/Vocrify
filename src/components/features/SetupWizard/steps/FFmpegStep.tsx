/**
 * Step 2: FFmpeg Installation Check
 * Verifies FFmpeg is installed and accessible.
 */
import { useEffect } from "react";
import { ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckCard, CheckItem } from "../CheckCard";
import { useSetupStore } from "@/stores/setupStore";
import { useI18n } from "@/hooks";

export function FFmpegStep() {
  const { t } = useI18n();
  const { ffmpegCheck, checkFFmpeg, installFFmpeg, isChecking, ffmpegProgress, ffmpegInstallStatus } = useSetupStore();

  useEffect(() => {
    if (!ffmpegCheck) {
      void checkFFmpeg();
    }
  }, [ffmpegCheck, checkFFmpeg]);

  const handleAutoInstall = async () => {
    await installFFmpeg();
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t("setup.ffmpegTitle")}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t("setup.ffmpegDesc")}
        </p>
      </div>

      <CheckCard
        title={t("setup.ffmpegTitle")}
        status={ffmpegCheck?.status ?? "pending"}
        message={ffmpegCheck?.message ?? t("setup.checkingFfmpeg")}
        onRetry={checkFFmpeg}
      >
        {ffmpegCheck && (
          <div className="space-y-1">
            <CheckItem
              label={
                ffmpegCheck.installed
                  ? `FFmpeg ${ffmpegCheck.version ?? "installed"}`
                  : t("setup.ffmpegNotFound")
              }
              sublabel={ffmpegCheck.path ?? undefined}
              status={ffmpegCheck.installed ? "ok" : "error"}
            />
          </div>
        )}
      </CheckCard>

      {ffmpegCheck?.status === "error" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
          <h4 className="font-medium text-red-700 dark:text-red-400">
            {t("setup.ffmpegInstallRequired")}
          </h4>
          <div className="text-sm space-y-2 text-muted-foreground">
            <p>{t("setup.ffmpegDesc")}</p>

            {/* Progress bar during installation */}
            {ffmpegInstallStatus === "downloading" && ffmpegProgress && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{t("setup.downloadingFfmpeg")}</span>
                  <span className="font-medium text-primary">
                    {ffmpegProgress.percent.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${ffmpegProgress.percent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  {(ffmpegProgress.currentBytes / (1024 * 1024)).toFixed(1)} MB /{" "}
                  {(ffmpegProgress.totalBytes / (1024 * 1024)).toFixed(1)} MB
                </p>
              </div>
            )}

            {ffmpegInstallStatus === "extracting" && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-center py-4">
                  <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent" />
                    <span className="text-sm text-foreground">{t("setup.extractingFfmpeg")}</span>
                  </div>
                </div>
              </div>
            )}

            {ffmpegInstallStatus === "idle" && (
              <div className="flex items-center gap-2 pt-2">
                <Button
                  onClick={handleAutoInstall}
                  disabled={isChecking}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  {t("setup.installAutomatically")}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t("setup.downloadSize")}
                </span>
              </div>
            )}

            {ffmpegInstallStatus === "failed" && (
              <div className="flex items-center gap-2 pt-2">
                <Button
                  onClick={handleAutoInstall}
                  disabled={isChecking}
                  variant="outline"
                  className="gap-2 border-red-500/50 text-red-700 hover:bg-red-500/10"
                >
                  <Download className="h-4 w-4" />
                  {t("setup.retryInstallation")}
                </Button>
              </div>
            )}

            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-primary hover:underline">
                {t("setup.manualInstructions")}
              </summary>
              <div className="mt-3 space-y-4">
                {/* Windows - Winget (recommended) */}
                <div className="space-y-2">
                  <p className="font-medium text-foreground">
                    Windows (recommended - winget):
                  </p>
                  <div className="bg-muted rounded-md p-3 font-mono text-xs">
                    <code>winget install -e --id Gyan.FFmpeg</code>
                  </div>
                </div>

                {/* Windows - Manual */}
                <div className="space-y-2">
                  <p className="font-medium text-foreground">Windows (manual):</p>
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
                    <li>Extract to a folder (e.g. `C:\ffmpeg`).</li>
                    <li>Add `C:\ffmpeg\bin` to `PATH`.</li>
                  </ol>
                </div>

                <div className="space-y-2">
                  <p className="font-medium text-foreground">Windows (Chocolatey):</p>
                  <div className="bg-muted rounded-md p-3 font-mono text-xs">
                    <code>choco install ffmpeg</code>
                  </div>
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
            </details>
          </div>
        </div>
      )}

      {isChecking && !ffmpegCheck && ffmpegInstallStatus === "idle" && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-pulse text-muted-foreground">{t("setup.checkingFfmpeg")}</div>
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
  const { t } = useI18n();
  const { ffmpegCheck, installFFmpeg, isChecking, ffmpegInstallStatus, ffmpegProgress } = useSetupStore();

  const hasError = ffmpegCheck?.status === "error";
  const canProceed = Boolean(ffmpegCheck?.installed && ffmpegCheck.status !== "error");
  const isInstalling = ffmpegInstallStatus === "downloading" || ffmpegInstallStatus === "extracting";

  const handleAutoInstall = async () => {
    await installFFmpeg();
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack} disabled={isInstalling}>
          {t("setup.back")}
        </Button>
        {hasError && ffmpegInstallStatus === "idle" && (
          <Button
            variant="outline"
            onClick={handleAutoInstall}
            disabled={isChecking}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {t("setup.installAutomatically")}
          </Button>
        )}
        {hasError && ffmpegInstallStatus === "failed" && (
          <Button
            variant="outline"
            onClick={handleAutoInstall}
            disabled={isChecking}
            className="gap-2 border-red-500/50 text-red-700 hover:bg-red-500/10"
          >
            <Download className="h-4 w-4" />
            {t("setup.retry")}
          </Button>
        )}
        {isInstalling && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
            <span>
              {ffmpegInstallStatus === "downloading" && ffmpegProgress
                ? `${t("setup.downloading")} ${ffmpegProgress.percent.toFixed(0)}%`
                : ffmpegInstallStatus === "extracting"
                ? t("setup.extracting")
                : t("setup.installing")}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onNext} disabled={isChecking || !canProceed || isInstalling}>
          {t("setup.continue")}
        </Button>
      </div>
    </div>
  );
}
