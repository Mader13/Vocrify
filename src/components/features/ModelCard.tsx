import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, Clock3, Download, Loader2, RefreshCw, Trash2, TriangleAlert } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { formatEta, formatSizeMb } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { AvailableModel, ModelDownloadState } from "@/types";

const modelCardVariants = cva("rounded-xl border bg-card text-card-foreground transition-colors duration-200", {
  variants: {
    variant: {
      default: "border-border/70 hover:border-border",
      installed: "border-emerald-500/30 bg-emerald-500/[0.05]",
      downloading: "border-primary/40 bg-primary/[0.08]",
      error: "border-destructive/50 bg-destructive/[0.08]",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface ModelCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof modelCardVariants> {
  model: AvailableModel;
  download?: ModelDownloadState | undefined;
  onDownload: () => void;
  onDownloadCancel?: () => void;
  onDelete: () => void;
  isDeleting?: boolean;
  pendingDeletion?: boolean;
  pendingDeletionError?: string;
  onSelect?: () => void;
  isSelected?: boolean;
  animationDelayMs?: number;
}

function renderStatusChip(
  isInstalled: boolean,
  isError: boolean,
  isDownloading: boolean,
  isPendingDeletion: boolean,
) {
  if (isDownloading) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        Downloading
      </span>
    );
  }

  if (isPendingDeletion) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
        <Clock3 className="h-3 w-3" />
        Delete pending
      </span>
    );
  }

  if (isError) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
        <TriangleAlert className="h-3 w-3" />
        Failed
      </span>
    );
  }

  if (isInstalled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
        <Check className="h-3 w-3" />
        Installed
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-md border border-border/70 bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">
      Not installed
    </span>
  );
}

export const ModelCard = React.forwardRef<HTMLDivElement, ModelCardProps>(
  (
    {
      className,
      model,
      download,
      onDownload,
      onDownloadCancel,
      onDelete,
      isDeleting = false,
      pendingDeletion = false,
      pendingDeletionError,
      onSelect,
      isSelected,
      animationDelayMs = 0,
      style,
      ...props
    },
    ref,
  ) => {
    const isDownloading = download?.status === "downloading";
    const isCancelled = download?.status === "cancelled";
    const isError = download?.status === "error" || isCancelled;
    const isInstalled = model.installed;
    const isPendingDeletion = pendingDeletion;

    const cardVariant = isDownloading
      ? "downloading"
      : isError
        ? "error"
        : isInstalled
          ? "installed"
          : "default";

    const [hasEntered, setHasEntered] = React.useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false);

    React.useEffect(() => {
      const timeout = setTimeout(() => setHasEntered(true), animationDelayMs);
      return () => clearTimeout(timeout);
    }, [animationDelayMs]);

    return (
      <>
        <div
          ref={ref}
          className={cn(
            modelCardVariants({ variant: cardVariant }),
            "motion-safe:duration-400 motion-safe:ease-out motion-reduce:transition-none",
            hasEntered ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
            "focus-within:ring-2 focus-within:ring-primary/35",
            isSelected && "ring-2 ring-primary/70 ring-offset-2",
            className,
          )}
          style={{ ...(style || {}), transitionDelay: `${animationDelayMs}ms` }}
          {...props}
        >
          <div className="p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-semibold leading-tight sm:text-base">{model.name}</h3>
                {renderStatusChip(isInstalled, isError, isDownloading, isPendingDeletion)}
                <span className="rounded-md border border-border/70 bg-background/80 px-2 py-0.5 text-xs text-muted-foreground">
                  {formatSizeMb(model.sizeMb)}
                </span>
              </div>

              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{model.description}</p>

              {isPendingDeletion && (
                <div className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  <p>This model is scheduled for deletion after active tasks finish.</p>
                  {pendingDeletionError && <p className="mt-1 opacity-80">Last error: {pendingDeletionError}</p>}
                </div>
              )}

              {isDownloading && download && (
                <div className="mt-4 space-y-3 rounded-lg border border-border/70 bg-background/80 p-3">
                  {download.currentStage && (
                    <p className="text-xs text-muted-foreground">
                      Stage: {download.currentStage === "segmentation" ? "Segmentation" : "Voice Embeddings"}
                    </p>
                  )}

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {formatSizeMb(download.currentMb)} / {formatSizeMb(download.totalMb)}
                      {download.totalEstimated ? " (estimated)" : ""}
                    </span>
                    <span className="font-semibold tabular-nums">{download.progress.toFixed(0)}%</span>
                  </div>

                  <Progress value={download.progress} className="h-1.5" />

                  <p className="text-xs text-muted-foreground">
                    {download.speedMbS > 0 ? `${download.speedMbS.toFixed(1)} MB/s` : "Calculating speed..."}
                    {formatEta(download.etaS) ? ` · ~${formatEta(download.etaS)} left` : ""}
                  </p>

                  {onDownloadCancel && (
                    <button
                      onClick={onDownloadCancel}
                      className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
                    >
                      Cancel download
                    </button>
                  )}
                </div>
              )}
            </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {isInstalled ? (
                  <>
                    {onSelect && !isPendingDeletion && (
                      <button
                        onClick={onSelect}
                        disabled={isDeleting}
                        className={cn(
                          "inline-flex h-10 min-w-32 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "border border-border/70 bg-background hover:bg-muted/60",
                        )}
                      >
                        {isSelected ? "Selected" : "Select"}
                      </button>
                    )}

                    <button
                      onClick={onDownload}
                      disabled={isDeleting || isPendingDeletion}
                      className="inline-flex h-10 min-w-32 items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-background px-3 text-sm font-medium transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Reinstall
                    </button>

                    <button
                      onClick={() => {
                        if (isPendingDeletion) {
                          onDelete();
                          return;
                        }

                        setIsDeleteDialogOpen(true);
                      }}
                      disabled={isDeleting}
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-destructive/35 bg-destructive/10 px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4" />
                          {isPendingDeletion ? "Retry delete" : "Delete"}
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={onDownload}
                    disabled={isDownloading}
                    className="inline-flex h-10 min-w-36 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    {isDownloading ? "Downloading..." : "Download"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete model</AlertDialogTitle>
              <AlertDialogDescription>
                Remove <span className="font-medium text-foreground">{model.name}</span> from local storage? You can
                download it again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onDelete();
                  setIsDeleteDialogOpen(false);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete model
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  },
);

ModelCard.displayName = "ModelCard";
