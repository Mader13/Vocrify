import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Switch } from "@/components/ui";
import { Select } from "@/components/ui";
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
import {
  getManagedCopyStorageDirectory,
  openManagedCopyStorageDirectory,
  setManagedCopyStorageDirectory,
} from "@/services/storage";
import { clearCache, getModelsDir, onModelsDirMoveProgress, openModelsFolder, selectOutputDirectory, setModelsDir } from "@/services/tauri";
import { useTasks } from "@/stores";
import { useModelsStore } from "@/stores/modelsStore";
import type { ArchiveCompression, CloseBehavior } from "@/types";

export function AdvancedTab() {
  const resetSettings = useTasks((s) => s.resetSettings);
  const settings = useTasks((s) => s.settings);
  const updateSettings = useTasks((s) => s.updateSettings);
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
  const [transcriptionStorageDirectory, setTranscriptionStorageDirectory] = React.useState("");
  const [transcriptionStorageError, setTranscriptionStorageError] = React.useState<string | null>(null);
  const [transcriptionStorageNotice, setTranscriptionStorageNotice] = React.useState<string | null>(null);
  const [isTranscriptionStorageLoading, setIsTranscriptionStorageLoading] = React.useState(true);
  const [isTranscriptionStorageUpdating, setIsTranscriptionStorageUpdating] = React.useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = React.useState(false);

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

  const loadTranscriptionStorageDirectory = React.useCallback(async () => {
    setIsTranscriptionStorageLoading(true);
    setTranscriptionStorageError(null);

    const result = await getManagedCopyStorageDirectory();
    if (result.success && result.data) {
      setTranscriptionStorageDirectory(result.data);
      updateSettings({ outputDirectory: result.data, managedCopyDirectory: result.data });
    } else {
      logger.error("Failed to load transcription storage directory", { error: result.error });
      setTranscriptionStorageError(t("settings.transcriptionStorageLoadError"));
    }

    setIsTranscriptionStorageLoading(false);
  }, [t, updateSettings]);

  React.useEffect(() => {
    void loadTranscriptionStorageDirectory();
  }, [loadTranscriptionStorageDirectory]);

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

  const handleSelectTranscriptionStorageDirectory = async () => {
    setTranscriptionStorageError(null);
    setTranscriptionStorageNotice(null);

    const selectedResult = await selectOutputDirectory();
    if (!selectedResult.success) {
      logger.error("Failed to open transcription storage directory picker", { error: selectedResult.error });
      setTranscriptionStorageError(t("settings.transcriptionStorageSetError"));
      return;
    }

    const selectedDirectory = selectedResult.data;
    if (!selectedDirectory) {
      return;
    }

    const normalizedCurrent = transcriptionStorageDirectory.trim().toLowerCase();
    const normalizedSelected = selectedDirectory.trim().toLowerCase();
    if (normalizedCurrent && normalizedCurrent === normalizedSelected) {
      return;
    }

    setIsTranscriptionStorageUpdating(true);

    try {
      const updateResult = await setManagedCopyStorageDirectory(selectedDirectory);
      if (!updateResult.success || !updateResult.data) {
        logger.error("Failed to set transcription storage directory", { error: updateResult.error });
        setTranscriptionStorageError(updateResult.error || t("settings.transcriptionStorageSetError"));
        return;
      }

      setTranscriptionStorageDirectory(updateResult.data);
      updateSettings({ outputDirectory: updateResult.data, managedCopyDirectory: updateResult.data });
      setTranscriptionStorageNotice(t("settings.transcriptionStorageUpdated"));
    } catch (error) {
      logger.error("Unexpected error while updating transcription storage directory", { error: String(error) });
      setTranscriptionStorageError(t("settings.transcriptionStorageSetError"));
    } finally {
      setIsTranscriptionStorageUpdating(false);
    }
  };

  const handleOpenTranscriptionStorageDirectory = async () => {
    setTranscriptionStorageError(null);

    const result = await openManagedCopyStorageDirectory();
    if (!result.success) {
      logger.error("Failed to open transcription storage directory", { error: result.error });
      setTranscriptionStorageError(t("settings.transcriptionStorageOpenError"));
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

  const handleOpenResetConfirm = () => {
    setIsResetConfirmOpen(true);
  };

  const handleConfirmResetSettings = () => {
    resetSettings();
    setIsResetConfirmOpen(false);
  };

  const handleCloseBehaviorChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ closeBehavior: event.target.value as CloseBehavior });
  };

  const handleManagedCopyEnabledChange = (checked: boolean) => {
    updateSettings({ managedCopyEnabled: checked });
  };

  const handleManagedCopyCompressionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ managedCopyCompression: event.target.value as ArchiveCompression });
  };

  return (
    <div className="space-y-8 h-full flex flex-col">
      <div>
        <h2 className="text-2xl font-semibold mb-1">{t("settings.advancedTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.advancedDescription")}</p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-border/50 hover:border-border transition-colors">
          <div>
            <h3 className="text-sm font-medium">{t("settings.closeBehaviorTitle")}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t("settings.closeBehaviorDescription")}</p>
          </div>

          <div className="space-y-2 max-w-xs">
            <label htmlFor="close-behavior" className="text-xs font-medium text-muted-foreground">
              {t("settings.closeBehaviorLabel")}
            </label>
            <Select
              id="close-behavior"
              value={settings.closeBehavior}
              onChange={handleCloseBehaviorChange}
              className="bg-background/80 dark:bg-background/50 backdrop-blur-sm border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20 transition-colors"
            >
              <option value="hide_to_tray">{t("settings.closeBehaviorHideToTray")}</option>
              <option value="exit">{t("settings.closeBehaviorExit")}</option>
            </Select>
          </div>
        </div>

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

        <div className="flex flex-col gap-4 p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-border/50 hover:border-border transition-colors">
          <div>
            <h3 className="text-sm font-medium">{t("settings.transcriptionStorageTitle")}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t("settings.transcriptionStorageDescription")}</p>
            <p className="mt-3 text-xs font-mono break-all text-foreground/90">
              {isTranscriptionStorageLoading ? t("common.loading") : transcriptionStorageDirectory || "-"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">{t("settings.transcriptionStorageHint")}</p>
            {transcriptionStorageError && (
              <p className="text-[11px] mt-2 text-destructive">{transcriptionStorageError}</p>
            )}
            {transcriptionStorageNotice && (
              <p className="text-[11px] mt-2 text-emerald-600 dark:text-emerald-400">{transcriptionStorageNotice}</p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
            <div className="pr-4">
              <p className="text-sm font-medium">{t("settings.managedCopyEnabledTitle")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("settings.managedCopyEnabledDescription")}</p>
            </div>
            <Switch
              checked={settings.managedCopyEnabled}
              onCheckedChange={handleManagedCopyEnabledChange}
            />
          </div>

          <div className="space-y-2 max-w-xs">
            <label htmlFor="managed-copy-compression" className="text-xs font-medium text-muted-foreground">
              {t("settings.managedCopyCompressionLabel")}
            </label>
            <Select
              id="managed-copy-compression"
              value={settings.managedCopyCompression}
              onChange={handleManagedCopyCompressionChange}
              disabled={!settings.managedCopyEnabled}
              className="bg-background/80 dark:bg-background/50 backdrop-blur-sm border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20 transition-colors"
            >
              <option value="none">{t("settings.archiveNoCompression")}</option>
              <option value="light">{t("settings.archiveLight")}</option>
              <option value="medium">{t("settings.archiveMedium")}</option>
              <option value="heavy">{t("settings.archiveHeavy")}</option>
            </Select>
            <p className="text-[11px] text-muted-foreground">{t("settings.managedCopyCompressionHint")}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={handleSelectTranscriptionStorageDirectory}
              disabled={isTranscriptionStorageLoading || isTranscriptionStorageUpdating}
              className="bg-background/80 dark:bg-background/50 hover:bg-background border border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20 text-foreground"
            >
              {t("settings.transcriptionStorageSelectAction")}
            </Button>
            <Button
              variant="outline"
              onClick={handleOpenTranscriptionStorageDirectory}
              disabled={isTranscriptionStorageLoading || isTranscriptionStorageUpdating}
            >
              {t("settings.transcriptionStorageOpenAction")}
            </Button>
          </div>
          {isTranscriptionStorageUpdating && (
            <p className="text-[11px] text-muted-foreground">{t("common.loading")}</p>
          )}
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
            onClick={handleOpenResetConfirm}
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

      <AlertDialog open={isResetConfirmOpen} onOpenChange={setIsResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.resetConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.resetConfirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmResetSettings}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("settings.resetAction")}
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
