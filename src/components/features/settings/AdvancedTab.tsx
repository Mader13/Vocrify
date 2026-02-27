import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui";
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
import { useI18n } from "@/hooks";
import { logger } from "@/lib/logger";
import { clearCache, getModelsDir, onModelsDirMoveProgress, openModelsFolder, selectOutputDirectory, setModelsDir } from "@/services/tauri";
import { useTasks } from "@/stores";
import { useModelsStore } from "@/stores/modelsStore";

export function AdvancedTab() {
  const resetSettings = useTasks((s) => s.resetSettings);
  const loadModels = useModelsStore((s) => s.loadModels);
  const loadDiskUsage = useModelsStore((s) => s.loadDiskUsage);

  const { t } = useI18n();

  const [modelsDirectory, setModelsDirectoryState] = React.useState("");
  const [modelsDirectoryError, setModelsDirectoryError] = React.useState<string | null>(null);
  const [modelsDirectoryNotice, setModelsDirectoryNotice] = React.useState<string | null>(null);
  const [pendingModelsDirectory, setPendingModelsDirectory] = React.useState<string | null>(null);
  const [isMoveConfirmOpen, setIsMoveConfirmOpen] = React.useState(false);
  const [isModelsMigrationInProgress, setIsModelsMigrationInProgress] = React.useState(false);
  const [modelsMoveProgress, setModelsMoveProgress] = React.useState(0);
  const [modelsMoveMessage, setModelsMoveMessage] = React.useState("");
  const [modelsMoveCounts, setModelsMoveCounts] = React.useState<{ moved: number; total: number }>({ moved: 0, total: 0 });
  const [isModelsDirectoryLoading, setIsModelsDirectoryLoading] = React.useState(true);
  const [isModelsDirectoryUpdating, setIsModelsDirectoryUpdating] = React.useState(false);

  const loadModelsDirectory = React.useCallback(async () => {
    setIsModelsDirectoryLoading(true);
    setModelsDirectoryError(null);

    const result = await getModelsDir();
    if (result.success && result.data) {
      setModelsDirectoryState(result.data);
    } else {
      logger.modelError("Failed to load models directory", { error: result.error });
      setModelsDirectoryError(t("settings.modelsDirectoryLoadError"));
    }

    setIsModelsDirectoryLoading(false);
  }, [t]);

  React.useEffect(() => {
    void loadModelsDirectory();
  }, [loadModelsDirectory]);

  React.useEffect(() => {
    let unlisten: (() => void) | null = null;

    void onModelsDirMoveProgress((event) => {
      setModelsMoveProgress(Math.max(0, Math.min(100, event.percent)));
      setModelsMoveMessage(event.message);
      setModelsMoveCounts({ moved: event.movedItems, total: event.totalItems });
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const refreshModelsData = React.useCallback(async () => {
    await Promise.all([loadModels(), loadDiskUsage()]);
  }, [loadDiskUsage, loadModels]);

  const handleSelectModelsDirectory = async () => {
    setModelsDirectoryError(null);
    setModelsDirectoryNotice(null);

    const selectedResult = await selectOutputDirectory();
    if (!selectedResult.success) {
      logger.modelError("Failed to open models directory picker", { error: selectedResult.error });
      setModelsDirectoryError(t("settings.modelsDirectorySetError"));
      return;
    }

    const selectedDirectory = selectedResult.data;
    if (!selectedDirectory) {
      return;
    }

    const normalizedCurrent = modelsDirectory.trim().toLowerCase();
    const normalizedSelected = selectedDirectory.trim().toLowerCase();
    if (normalizedCurrent && normalizedCurrent === normalizedSelected) {
      return;
    }

    setPendingModelsDirectory(selectedDirectory);
    setIsMoveConfirmOpen(true);
  };

  const handleConfirmModelsMove = async () => {
    if (!pendingModelsDirectory) {
      return;
    }

    setIsMoveConfirmOpen(false);
    setIsModelsDirectoryUpdating(true);
    setIsModelsMigrationInProgress(true);
    setModelsMoveProgress(0);
    setModelsMoveMessage(t("settings.modelsDirectoryMoveInProgressDescription"));
    setModelsMoveCounts({ moved: 0, total: 0 });
    setModelsDirectoryError(null);
    setModelsDirectoryNotice(null);

    try {
      const updateResult = await setModelsDir(pendingModelsDirectory, true);
      if (!updateResult.success || !updateResult.data) {
        logger.modelError("Failed to migrate models directory", { error: updateResult.error });
        setModelsDirectoryError(updateResult.error || t("settings.modelsDirectorySetError"));
        return;
      }

      setModelsDirectoryState(updateResult.data.path);
      setModelsDirectoryNotice(
        `${t("settings.modelsDirectoryMoveSuccessPrefix")} ${updateResult.data.movedItems} ${t("settings.modelsDirectoryMoveSuccessSuffix")}`,
      );
      await refreshModelsData();
    } catch (error) {
      logger.modelError("Unexpected error while migrating models directory", { error: String(error) });
      setModelsDirectoryError(t("settings.modelsDirectorySetError"));
    } finally {
      setIsModelsDirectoryUpdating(false);
      setIsModelsMigrationInProgress(false);
      setPendingModelsDirectory(null);
    }
  };

  const handleCancelModelsMove = () => {
    setIsMoveConfirmOpen(false);
    setPendingModelsDirectory(null);
  };

  const handleOpenModelsDirectory = async () => {
    const result = await openModelsFolder();
    if (!result.success) {
      logger.modelError("Failed to open models directory", { error: result.error });
      setModelsDirectoryError(t("settings.modelsDirectorySetError"));
    }
  };

  const handleClearCache = async () => {
    const result = await clearCache();
    if (result.success) {
      window.location.reload();
    } else {
      logger.error("Failed to clear cache", { error: result.error });
    }
  };

  return (
    <div className="space-y-8 h-full flex flex-col">
      <div>
        <h2 className="text-2xl font-semibold mb-1">{t("settings.advancedTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.advancedDescription")}</p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-4 p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-border/50 hover:border-border transition-colors">
          <div>
            <h3 className="text-sm font-medium">{t("settings.modelsDirectoryTitle")}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t("settings.modelsDirectoryDescription")}</p>
            <p className="mt-3 text-xs font-mono break-all text-foreground/90">
              {isModelsDirectoryLoading ? t("common.loading") : modelsDirectory || "-"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">{t("settings.modelsDirectoryHint")}</p>
            {modelsDirectoryError && (
              <p className="text-[11px] mt-2 text-destructive">{modelsDirectoryError}</p>
            )}
            {modelsDirectoryNotice && (
              <p className="text-[11px] mt-2 text-emerald-600 dark:text-emerald-400">{modelsDirectoryNotice}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={handleSelectModelsDirectory}
              disabled={isModelsDirectoryLoading || isModelsDirectoryUpdating || isModelsMigrationInProgress}
              className="bg-background/80 dark:bg-background/50 hover:bg-background border border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20 text-foreground"
            >
              {t("settings.modelsDirectorySelectAction")}
            </Button>
            <Button
              variant="outline"
              onClick={handleOpenModelsDirectory}
              disabled={isModelsDirectoryLoading || isModelsDirectoryUpdating || isModelsMigrationInProgress}
            >
              {t("settings.modelsDirectoryOpenAction")}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-border/50 hover:border-border transition-colors">
          <div>
            <h3 className="text-sm font-medium">{t("settings.clearCacheTitle")}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t("settings.clearCacheDescription")}</p>
          </div>
          <Button
            variant="secondary"
            onClick={handleClearCache}
            className="bg-background/80 dark:bg-background/50 hover:bg-background border border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20 text-foreground"
          >
            {t("settings.clearCacheAction")}
          </Button>
        </div>

        <div className="flex items-center justify-between p-4 rounded-2xl bg-destructive/10 border border-destructive/35 hover:border-destructive/50 transition-colors">
          <div>
            <h3 className="text-sm font-medium text-destructive">{t("settings.resetTitle")}</h3>
            <p className="text-xs mt-1 text-destructive/85 dark:text-destructive/80">{t("settings.resetDescription")}</p>
          </div>
          <Button
            variant="destructive"
            onClick={resetSettings}
            className="shadow-[0_0_15px_rgba(239,68,68,0.2)] hover:shadow-[0_0_25px_rgba(239,68,68,0.4)]"
          >
            {t("settings.resetAction")}
          </Button>
        </div>
      </div>

      <AlertDialog
        open={isMoveConfirmOpen}
        onOpenChange={(open) => {
          setIsMoveConfirmOpen(open);
          if (!open) {
            setPendingModelsDirectory(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.modelsDirectoryMoveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.modelsDirectoryMoveDescription")}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3 text-xs">
            <div>
              <p className="font-medium text-muted-foreground">{t("settings.modelsDirectoryCurrentPathLabel")}</p>
              <p className="mt-1 break-all font-mono text-foreground/90">{modelsDirectory || "-"}</p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">{t("settings.modelsDirectoryNewPathLabel")}</p>
              <p className="mt-1 break-all font-mono text-foreground/90">{pendingModelsDirectory || "-"}</p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancelModelsMove}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmModelsMove}>
              {t("settings.modelsDirectoryMoveConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isModelsMigrationInProgress} onOpenChange={() => undefined}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings.modelsDirectoryMoveInProgressTitle")}</DialogTitle>
            <DialogDescription>{t("settings.modelsDirectoryMoveInProgressDescription")}</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-foreground/90">{modelsMoveMessage || t("common.loading")}</span>
            </div>
            <Progress value={modelsMoveProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {modelsMoveProgress}%{" "}
              {modelsMoveCounts.total > 0 ? `(${modelsMoveCounts.moved} / ${modelsMoveCounts.total})` : ""}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
