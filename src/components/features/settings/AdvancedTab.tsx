import { Button } from "@/components/ui";
import { useTasks } from "@/stores";
import { clearCache } from "@/services/tauri";
import { logger } from "@/lib/logger";
import { useI18n } from "@/hooks";

export function AdvancedTab() {
  const resetSettings = useTasks((s) => s.resetSettings);
  const { t } = useI18n();

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
    </div>
  );
}
