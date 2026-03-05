import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks";
import { logger } from "@/lib/logger";
import { selectOutputDirectory } from "@/services/tauri";
import {
  getManagedCopyStorageDirectory,
  setManagedCopyStorageDirectory,
} from "@/services/storage";
import { useSettingsActions, useSetting } from "@/stores/settingsStore";

export function StorageStep() {
  const { t } = useI18n();
  const { updateSettings } = useSettingsActions();
  const settingsDirectory = useSetting("managedCopyDirectory");

  const [directory, setDirectory] = useState(settingsDirectory);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bootstrapDirectory = async () => {
      setIsLoading(true);
      setError(null);

      const result = await getManagedCopyStorageDirectory();
      if (!result.success || !result.data) {
        setError(result.error || "Failed to load storage directory");
        setIsLoading(false);
        return;
      }

      setDirectory(result.data);
      updateSettings({ outputDirectory: result.data, managedCopyDirectory: result.data });
      setIsLoading(false);
    };

    void bootstrapDirectory();
  }, [updateSettings]);

  const handleChooseDirectory = async () => {
    setError(null);

    const selectedResult = await selectOutputDirectory();
    if (!selectedResult.success) {
      setError(selectedResult.error || "Failed to select directory");
      return;
    }

    if (!selectedResult.data) {
      return;
    }

    const saveResult = await setManagedCopyStorageDirectory(selectedResult.data);
    if (!saveResult.success || !saveResult.data) {
      setError(saveResult.error || "Failed to save storage directory");
      return;
    }

    const nextDirectory = saveResult.data;
    setDirectory(nextDirectory);
    updateSettings({ outputDirectory: nextDirectory, managedCopyDirectory: nextDirectory });

    logger.info("Setup storage directory selected", { directory: nextDirectory });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t("setup.storageTitle")}</h3>
        <p className="text-sm text-muted-foreground mt-1">{t("setup.storageDescription")}</p>
      </div>

      <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-3">
        <h4 className="text-sm font-medium">{t("setup.storageFolderLabel")}</h4>
        <p className="text-xs text-muted-foreground">{t("setup.storageFolderHint")}</p>
        <p className="text-xs font-mono break-all text-foreground/90">
          {isLoading ? t("common.loading") : directory || "-"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleChooseDirectory}
            disabled={isLoading}
            className="gap-2"
          >
            <FolderOpen className="h-4 w-4" />
            {t("setup.storageChangeAction")}
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

export interface StorageStepFooterProps {
  onBack: () => void;
  onNext: () => void;
}

export function StorageStepFooter({ onBack, onNext }: StorageStepFooterProps) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" onClick={onBack}>
        {t("common.back")}
      </Button>
      <Button onClick={onNext}>{t("common.continue")}</Button>
    </div>
  );
}
