import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { AvailableModel, ModelDownloadState } from "@/types";
import { MODEL_ICONS, isPyannoteModel, isSherpaModel } from "@/types";
import { Progress } from "@/components/ui/progress";
import { useTasks } from "@/stores";

const modelCardVariants = cva(
  "relative overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:translate-y-[-1px]",
  {
    variants: {
      variant: {
        default: "border-border hover:border-border/80",
        installed: "border-primary/30 bg-primary/5 hover:border-primary/40 hover:bg-primary/[0.07]",
        downloading: "border-primary/50 bg-primary/10 hover:border-primary/60 hover:bg-primary/[0.12]",
        error: "border-destructive/50 bg-destructive/5 hover:border-destructive/60 hover:bg-destructive/[0.07]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface ModelCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof modelCardVariants> {
  model: AvailableModel;
  download?: ModelDownloadState | undefined;
  onDownload: () => void;
  onDownloadCancel?: () => void;
  onDelete: () => void;
  onSelect?: () => void;
  isSelected?: boolean;
}

export const ModelCard = React.forwardRef<HTMLDivElement, ModelCardProps>(
  ({ className, model, download, onDownload, onDownloadCancel, onDelete, onSelect, isSelected, variant, ...props }, ref) => {
    const isDownloading = download?.status === "downloading";
    const isCancelled = download?.status === "cancelled";
    const isError = download?.status === "error";
    const isInstalled = model.installed;
    
    const isPyannote = isPyannoteModel(model.name);
    const isSherpa = isSherpaModel(model.name);
    const huggingFaceToken = useTasks((s) => s.settings.huggingFaceToken);
    const needsToken = isPyannote && !huggingFaceToken;

    const cardVariant = isCancelled
      ? "error"
      : isDownloading
      ? "downloading"
      : isError
      ? "error"
      : isInstalled
      ? "installed"
      : "default";

    const formatSize = (mb: number): string => {
      if (mb >= 1024) {
        return `${(mb / 1024).toFixed(1)} GB`;
      }
      return `${mb} MB`;
    };

    return (
      <div
        ref={ref}
        className={cn(modelCardVariants({ variant: cardVariant }), isSelected && "ring-2 ring-primary ring-offset-2", className)}
        {...props}
      >
        {/* Token warning badge */}
        {needsToken && (
          <div className="absolute top-3 right-3 z-10 group/icon">
            <div className="relative">
              <div className="w-6 h-6 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center cursor-help transition-colors duration-150 hover:bg-amber-500/20">
                <svg
                  className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              {/* Tooltip - shows on icon hover */}
              <div className="absolute top-full right-0 mt-2 w-56 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/90 border border-amber-200 dark:border-amber-700 shadow-lg opacity-0 invisible group-hover/icon:opacity-100 group-hover/icon:visible transition-all duration-200 z-50">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  Требуется HuggingFace токен
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                  Добавьте токен в настройках приложения
                </p>
              </div>
            </div>
          </div>
        )}

        {/* PyAnnote info badge */}
        {isPyannote && (
          <div className={cn("absolute z-10 group/icon", needsToken ? "top-11 right-3" : "top-3 right-3")}>
            <div className="relative">
              <div className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center cursor-help transition-colors duration-150 hover:bg-blue-500/20">
                <svg
                  className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              {/* Tooltip - shows on icon hover */}
              <div className="absolute top-full right-0 mt-2 w-56 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/90 border border-blue-200 dark:border-blue-700 shadow-lg opacity-0 invisible group-hover/icon:opacity-100 group-hover/icon:visible transition-all duration-200 z-50">
                <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
                  Комплект моделей
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Вместе с этой моделью автоматически скачается segmentation модель (68 MB)
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Sherpa info badge */}
        {isSherpa && (
          <div className="absolute top-3 right-3 z-10 group/icon">
            <div className="relative">
              <div className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center cursor-help transition-colors duration-150 hover:bg-blue-500/20">
                <svg
                  className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              {/* Tooltip - shows on icon hover */}
              <div className="absolute top-full right-0 mt-2 w-56 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/90 border border-blue-200 dark:border-blue-700 shadow-lg opacity-0 invisible group-hover/icon:opacity-100 group-hover/icon:visible transition-all duration-200 z-50">
                <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
                  Комплект моделей
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Вместе с этой моделью автоматически скачается segmentation модель (35 MB)
                </p>
              </div>
            </div>
          </div>
        )}
        <div className="p-4 flex flex-col h-full min-h-[280px]">
          <div className="flex-1 flex flex-col">
            <div className="flex items-start gap-3">
              <span className="text-2xl">{MODEL_ICONS[model.modelType]}</span>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm leading-tight">{model.name}</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{model.description}</p>
                <span className="inline-flex items-center text-xs font-medium text-muted-foreground/80 bg-muted/30 px-2 py-0.5 rounded mt-2">
                  {formatSize(model.sizeMb)}
                </span>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {isDownloading && download && (
                <div className="space-y-3">
                  {/* Show current stage info for multi-stage downloads */}
                  {download.currentStage && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium">Этап: {download.currentStage === "segmentation" ? "Сегментация" : "Голосовые отпечатки"}</span>
                      {download.stages?.segmentation?.completed && (
                        <span className="text-success">✓</span>
                      )}
                    </div>
                  )}

                  {/* Main progress bar */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {formatSize(download.currentMb)} / {formatSize(download.totalMb)}
                    </span>
                    <span className="font-medium">{download.progress.toFixed(0)}%</span>
                  </div>
                  <Progress value={download.progress} className="h-1.5" />

                  {/* Show individual stage progress bars for multi-stage downloads */}
                  {download.stages && (
                    <div className="space-y-2">
                      {download.stages.segmentation && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Сегментация</span>
                            <span>{download.stages.segmentation.completed ? "✓" : `${download.stages.segmentation.progress.toFixed(0)}%`}</span>
                          </div>
                          {!download.stages.segmentation.completed && (
                            <Progress value={download.stages.segmentation.progress} className="h-1" />
                          )}
                        </div>
                      )}
                      {download.stages.embedding && (download.stages.segmentation?.completed || download.currentStage === "embedding") && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Голосовые отпечатки</span>
                            <span>{download.stages.embedding.completed ? "✓" : `${download.stages.embedding.progress.toFixed(0)}%`}</span>
                          </div>
                          {!download.stages.embedding.completed && (
                            <Progress value={download.stages.embedding.progress} className="h-1" />
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {download.speedMbS && download.speedMbS !== "0" && (
                    <p className="text-xs text-muted-foreground">
                      {download.speedMbS} MB/s
                    </p>
                  )}
                  {onDownloadCancel && (
                    <button
                      onClick={onDownloadCancel}
                      className="w-full px-3 py-1.5 text-xs bg-destructive/10 text-destructive rounded-lg hover:bg-destructive/20 transition-all duration-150"
                    >
                      Отмена
                    </button>
                  )}
                </div>
              )}

              {isError && download && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                  Ошибка: {download.error || "Неизвестная ошибка"}
                </div>
              )}

              {!isDownloading && !isError && (
                <div className="flex items-center gap-2">
                  {isInstalled ? (
                    <div className="flex items-center gap-2 text-sm text-success">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      Установлено
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                      Не установлено
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-2 border-t pt-4">
            {isInstalled ? (
              <>
                {onSelect && (
                  <button
                    onClick={onSelect}
                    className={cn(
                      "flex-1 inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 h-10",
                      isSelected
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-sm active:scale-[0.98]"
                    )}
                  >
                    {isSelected ? (
                      <>
                        <svg
                          className="w-4 h-4 mr-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Выбрано
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4 mr-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                          />
                        </svg>
                        Выбрать
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={onDownload}
                  disabled={needsToken}
                  title={needsToken ? "Требуется HuggingFace токен" : undefined}
                  className={cn(
                    "inline-flex items-center justify-center rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-sm active:scale-[0.98] h-10",
                    onSelect && "flex-1"
                  )}
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Переустановить
                </button>
                <button
                  onClick={onDelete}
                  className="inline-flex items-center justify-center rounded-lg border border-destructive/20 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-all duration-150 hover:shadow-sm active:scale-[0.98] h-10"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </>
            ) : (
              <button
                onClick={onDownload}
                disabled={isDownloading || needsToken}
                title={needsToken ? "Требуется HuggingFace токен" : undefined}
                className="flex-1 inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-sm active:scale-[0.98] h-10"
              >
                <svg
                  className="w-4 h-4 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                {isDownloading ? "Загрузка..." : needsToken ? "Требуется токен" : "Скачать"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
);

ModelCard.displayName = "ModelCard";
