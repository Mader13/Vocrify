import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { AvailableModel, ModelDownloadState } from "@/types";
import { isPyannoteModel } from "@/types";
import { Progress } from "@/components/ui/progress";
import { useTasks } from "@/stores";

const modelCardVariants = cva(
  "relative rounded-xl border bg-card text-card-foreground shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-px",
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
  animationDelayMs?: number;
}

export const ModelCard = React.forwardRef<HTMLDivElement, ModelCardProps>(
  ({
    className,
    model,
    download,
    onDownload,
    onDownloadCancel,
    onDelete,
    onSelect,
    isSelected,
    variant,
    animationDelayMs = 0,
    style,
    ...props
  }, ref) => {
    const isDownloading = download?.status === "downloading";
    const isCancelled = download?.status === "cancelled";
    const isError = download?.status === "error";
    const isInstalled = model.installed;
    
    const isPyannote = isPyannoteModel(model.name);
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

    const formatEta = (etaS?: number): string | null => {
      if (!etaS || etaS <= 0) return null;
      const totalSeconds = Math.round(etaS);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    };

    const [hasEntered, setHasEntered] = React.useState(false);

    React.useEffect(() => {
      // Respect prefers-reduced-motion via CSS classes; still delay mount for stagger effect
      const t = setTimeout(() => setHasEntered(true), animationDelayMs);
      return () => clearTimeout(t);
    }, [animationDelayMs]);

    return (
      <div
        ref={ref}
        className={cn(
          modelCardVariants({ variant: cardVariant }),
          "motion-safe:duration-500 motion-safe:ease-out motion-safe:will-change-transform motion-reduce:transition-none motion-reduce:transform-none",
          hasEntered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
          "focus-within:ring-2 focus-within:ring-primary/40",
          isSelected && "ring-2 ring-primary ring-offset-2",
          className
        )}
        style={{ ...(style || {}), transitionDelay: `${animationDelayMs}ms` }}
        {...props}
      >

        <div className="p-4 sm:p-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_auto] xl:items-start">
            <div className="min-w-0">
              <div className="flex items-start">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold leading-tight sm:text-base">
                    {model.name}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                    {model.description}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/30 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {formatSize(model.sizeMb)}
                    </span>

                    {!isDownloading && !isError && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                          isInstalled
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-border/70 bg-muted/20 text-muted-foreground"
                        )}
                      >
                        {isInstalled ? (
                          <>
                            <svg
                              className="h-3.5 w-3.5"
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
                            Installed
                          </>
                        ) : (
                          <>
                            <svg
                              className="h-3.5 w-3.5"
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
                            Not Installed
                          </>
                        )}
                      </span>
                    )}

                    {/* Token warning badge */}
                    {needsToken && (
                      <div className="relative group/icon">
                        <div className="w-5 h-5 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center cursor-help transition-colors duration-150 hover:bg-amber-500/20">
                          <svg
                            className="w-3 h-3 text-amber-600 dark:text-amber-400"
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
                        {/* Tooltip */}
                        <div className="absolute bottom-full right-0 mb-2 w-56 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/90 border border-amber-200 dark:border-amber-700 shadow-lg opacity-0 invisible group-hover/icon:opacity-100 group-hover/icon:visible transition-all duration-200 z-50">
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                            HuggingFace Token Required
                          </p>
                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                            Add your token in app settings
                          </p>
                        </div>
                      </div>
                    )}


                  </div>
                </div>
              </div>

              {isDownloading && download && (
                <div className="mt-4 space-y-3 rounded-lg border border-border/60 bg-background/30 p-3 sm:p-4">
                  {/* Show current stage info for multi-stage downloads */}
                  {download.currentStage && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium">Stage: {download.currentStage === "segmentation" ? "Segmentation" : "Voice Embeddings"}</span>
                      {download.stages?.segmentation?.completed && (
                        <span className="text-success">✓</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {formatSize(download.currentMb)} / {formatSize(download.totalMb)}
                      {download.totalEstimated ? " (estimated)" : ""}
                    </span>
                    <span className="font-medium">{download.progress.toFixed(0)}%</span>
                  </div>
                  <Progress value={download.progress} className="h-1.5" />

                  {download.stages && (
                    <div className="space-y-2">
                      {download.stages.segmentation && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Segmentation</span>
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
                            <span>Voice Embeddings</span>
                            <span>{download.stages.embedding.completed ? "✓" : `${download.stages.embedding.progress.toFixed(0)}%`}</span>
                          </div>
                          {!download.stages.embedding.completed && (
                            <Progress value={download.stages.embedding.progress} className="h-1" />
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs text-muted-foreground">
                      {download.speedMbS && download.speedMbS !== "0" ? `${download.speedMbS} MB/s` : "Calculating speed..."}
                      {formatEta(download.etaS) ? ` • ~${formatEta(download.etaS)} left` : ""}
                    </p>
                    {onDownloadCancel && (
                      <button
                        onClick={onDownloadCancel}
                        className="ml-auto rounded-lg bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-all duration-150 hover:bg-destructive/20"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 self-center xl:justify-end">
            {isInstalled ? (
              <>
                {onSelect && (
                  <button
                    onClick={onSelect}
                    className={cn(
                        "inline-flex h-10 min-w-40 items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
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
                        Selected
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
                        Select
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={onDownload}
                  disabled={needsToken}
                  title={needsToken ? "HuggingFace Token Required" : undefined}
                  className={cn(
                    "inline-flex h-10 min-w-36 items-center justify-center rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground transition-all duration-150 hover:bg-secondary/80 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
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
                  Reinstall
                </button>
                <button
                  onClick={onDelete}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-destructive/20 px-3 py-2 text-sm font-medium text-destructive transition-all duration-150 hover:bg-destructive/10 hover:shadow-sm active:scale-[0.98]"
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
                title={needsToken ? "HuggingFace Token Required" : undefined}
                className="inline-flex h-10 min-w-40 items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
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
                {isDownloading ? "Downloading..." : needsToken ? "Token Required" : "Download"}
              </button>
            )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ModelCard.displayName = "ModelCard";
