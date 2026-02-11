import { useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckCard, CheckItem } from "../CheckCard";
import { useSetupStore } from "@/stores/setupStore";

/**
 * Step 2: FFmpeg Installation Check
 * Verifies FFmpeg is installed and accessible
 */
export function FFmpegStep() {
  const { ffmpegCheck, checkFFmpeg, isChecking } = useSetupStore();

  // Run check on mount
  useEffect(() => {
    if (!ffmpegCheck) {
      checkFFmpeg();
    }
  }, [ffmpegCheck, checkFFmpeg]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">FFmpeg</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Проверка FFmpeg для обработки аудио/видео
        </p>
      </div>

      {/* Main check card */}
      <CheckCard
        title="FFmpeg"
        status={ffmpegCheck?.status ?? "pending"}
        message={ffmpegCheck?.message ?? "Проверка FFmpeg..."}
        onRetry={checkFFmpeg}
      >
        {ffmpegCheck && (
          <div className="space-y-1">
            {/* FFmpeg installation status */}
            <CheckItem
              label={
                ffmpegCheck.installed
                  ? `FFmpeg ${ffmpegCheck.version ?? "установлен"}`
                  : "FFmpeg не найден"
              }
              sublabel={ffmpegCheck.path ?? undefined}
              status={ffmpegCheck.installed ? "ok" : "error"}
            />
          </div>
        )}
      </CheckCard>

      {/* Installation instructions for errors */}
      {ffmpegCheck?.status === "error" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-3">
          <h4 className="font-medium text-red-600 dark:text-red-400">
            Требуется установка FFmpeg
          </h4>
          <div className="text-sm space-y-2 text-muted-foreground">
            <p>FFmpeg необходим для обработки аудио и видео файлов:</p>
            
            <div className="space-y-2">
              <p className="font-medium text-foreground">Windows:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>
                  Скачайте FFmpeg с{" "}
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
                <li>Распакуйте архив в папку (например, C:\ffmpeg)</li>
                <li>Добавьте C:\ffmpeg\bin в переменную PATH</li>
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

      {/* Loading state */}
      {isChecking && !ffmpegCheck && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-pulse text-muted-foreground">
            Проверка FFmpeg...
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Footer actions for FFmpeg step
 */
export interface FFmpegStepFooterProps {
  onBack: () => void;
  onNext: () => void;
}

export function FFmpegStepFooter({ onBack, onNext }: FFmpegStepFooterProps) {
  const { ffmpegCheck, checkFFmpeg, isChecking } = useSetupStore();
  
  const hasError = ffmpegCheck?.status === "error";

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack}>
          Назад
        </Button>
        {hasError && (
          <Button
            variant="outline"
            onClick={() => checkFFmpeg()}
            disabled={isChecking}
          >
            Повторить
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onNext} disabled={isChecking}>
          {hasError ? "Пропустить" : "Продолжить"}
        </Button>
      </div>
    </div>
  );
}
