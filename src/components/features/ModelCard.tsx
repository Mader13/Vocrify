import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, Clock3, Download, Loader2, Trash2, TriangleAlert } from "lucide-react";

import { useI18n } from "@/hooks";

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

const modelCardVariants = cva("rounded-xl transition-all duration-300 ease-out", {
  variants: {
    variant: {
      default: "bg-card/40 hover:bg-muted/30 border border-transparent shadow-sm",
      installed: "border border-emerald-500/10 bg-emerald-500/[0.03] shadow-sm",
      downloading: "border border-primary/20 bg-primary/[0.04] shadow-sm",
      error: "border border-destructive/20 bg-destructive/[0.04] shadow-sm",
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

function useStatusChip() {
  const { t } = useI18n();

  return function renderStatusChip(
    isInstalled: boolean,
    isError: boolean,
    isDownloading: boolean,
    isPendingDeletion: boolean,
  ) {
    if (isDownloading) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("models.downloading")}
        </span>
      );
    }

    if (isPendingDeletion) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
          <Clock3 className="h-3 w-3" />
          {t("models.deletePending")}
        </span>
      );
    }

    if (isError) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
          <TriangleAlert className="h-3 w-3" />
          {t("models.failed")}
        </span>
      );
    }

    if (isInstalled) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="h-3 w-3" />
          {t("models.installed")}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center rounded-md border border-border/40 bg-background/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {t("models.notInstalled")}
      </span>
    );
  };
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

    const { t } = useI18n();
    const renderStatusChip = useStatusChip();
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

              <p className="mt-2.5 text-[14px] leading-[1.6] text-muted-foreground/80">{model.description}</p>

              {isPendingDeletion && (
                <div className="mt-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  <p>{t("models.pendingDeletionInfo")}</p>
                  {pendingDeletionError && <p className="mt-1 opacity-80">{t("models.lastError")} {pendingDeletionError}</p>}
                </div>
              )}

              {isDownloading && download && (
                <div className="mt-4 space-y-3 rounded-lg border border-border/70 bg-background/80 p-3">
                  {download.currentStage && (
                    <p className="text-xs text-muted-foreground">
                      {t("models.stage")} {download.currentStage === "segmentation" ? t("models.segmentation") : t("models.voiceEmbeddings")}
                    </p>
                  )}

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {formatSizeMb(download.currentMb)} / {formatSizeMb(download.totalMb)}
                      {download.totalEstimated ? ` ${t("models.estimated")}` : ""}
                    </span>
                    <span className="font-semibold tabular-nums">{download.progress.toFixed(0)}%</span>
                  </div>

                  <Progress value={download.progress} className="h-1.5" />

                  <p className="text-xs text-muted-foreground">
                    {download.speedMbS > 0 ? `${download.speedMbS.toFixed(1)} MB/s` : t("models.calculatingSpeed")}
                    {formatEta(download.etaS) ? ` · ~${formatEta(download.etaS)} ${t("models.left")}` : ""}
                  </p>

                  {onDownloadCancel && (
                    <button
                      onClick={onDownloadCancel}
                      className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
                    >
                      {t("models.cancelDownload")}
                    </button>
                  )}
                </div>
              )}
            </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end mt-4 lg:mt-0">
                {isInstalled ? (
                  <>
                    {onSelect && !isPendingDeletion && (
                      <button
                        onClick={onSelect}
                        disabled={isDeleting}
                        className={cn(
                          "inline-flex h-9 min-w-28 items-center justify-center rounded-lg px-3 text-[13px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50",
                          isSelected
                            ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                            : "bg-background/60 text-foreground hover:bg-muted/80 backdrop-blur-sm",
                        )}
                      >
                        {isSelected ? t("models.selected") : t("models.select")}
                      </button>
                    )}

                    <button
                      onClick={() => {
                        if (isPendingDeletion) {
                          onDelete();
                          return;
                        }

                        setIsDeleteDialogOpen(true);
                      }}
                      disabled={isDeleting}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-destructive/10 px-3 text-[13px] font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t("models.deleting")}
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-3.5 w-3.5" />
                          {isPendingDeletion ? t("models.retryDelete") : t("common.delete")}
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={onDownload}
                    disabled={isDownloading}
                    className="inline-flex h-9 min-w-32 items-center justify-center gap-1.5 rounded-lg bg-primary/10 text-primary px-3 text-[13px] font-semibold transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {isDownloading ? `${t("models.downloading")}...` : t("models.downloadAction")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("models.deleteModel")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("models.removePrefix")} <span className="font-medium text-foreground">{model.name}</span> {t("models.deleteModelDesc")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setIsDeleteDialogOpen(false)}>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onDelete();
                  setIsDeleteDialogOpen(false);
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("models.deleteModel")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  },
);

ModelCard.displayName = "ModelCard";
