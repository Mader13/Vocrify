import { useEffect, useState } from "react";
import { ExternalLink, FolderOpen, Heart } from "lucide-react";
import { Button } from "@/components/ui";
import { useI18n } from "@/hooks";
import { logger } from "@/lib/logger";
import { getAppVersion, openAppDirectory, openExternalUrl } from "@/services/tauri/app-commands";

const SUPPORT_URL = "https://boosty.to/minti-dev";

export function AboutTab() {
  const { t } = useI18n();
  const [appVersion, setAppVersion] = useState<string>(t("settings.aboutVersionUnknown"));

  useEffect(() => {
    let isMounted = true;

    const loadVersion = async () => {
      const result = await getAppVersion();
      if (!isMounted) return;

      if (result.success && result.data) {
        setAppVersion(`v${result.data}`);
        return;
      }

      logger.error("Failed to load app version for About tab", { error: result.error });
      setAppVersion(t("settings.aboutVersionUnknown"));
    };

    loadVersion();

    return () => {
      isMounted = false;
    };
  }, [t]);

  const handleOpenAppDirectory = async () => {
    const result = await openAppDirectory();
    if (!result.success) {
      logger.error("Failed to open app directory from About tab", { error: result.error });
    }
  };

  const handleOpenSupportLink = async () => {
    const result = await openExternalUrl(SUPPORT_URL);
    if (!result.success) {
      logger.error("Failed to open support link from About tab", {
        url: SUPPORT_URL,
        error: result.error,
      });
    }
  };

  return (
    <div className="space-y-8 h-full flex flex-col pb-6">
      <div>
        <h2 className="text-2xl font-semibold mb-1">{t("settings.aboutTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.aboutDescription")}</p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-border/50 hover:border-border transition-colors">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{t("settings.aboutVersionLabel")}</p>
            <p className="text-lg font-semibold">{appVersion}</p>
            <p className="text-xs text-muted-foreground">{t("settings.aboutDirectoryHint")}</p>
          </div>
          <Button
            variant="secondary"
            onClick={handleOpenAppDirectory}
            className="bg-background/80 dark:bg-background/50 hover:bg-background border border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20 text-foreground"
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            {t("settings.aboutOpenDirectory")}
          </Button>
        </div>

        <div className="relative overflow-hidden p-5 rounded-2xl border border-rose-400/30 bg-gradient-to-r from-rose-500/15 via-amber-400/10 to-orange-500/15">
          <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-rose-400/10 blur-2xl" />
          <div className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full bg-orange-400/10 blur-2xl" />
          <div className="relative space-y-2">
            <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300">
              <Heart className="h-4 w-4 fill-current" />
              <span className="text-sm font-semibold">{t("settings.aboutBuiltByTitle")}</span>
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">{t("settings.aboutBuiltByDescription")}</p>
            
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-border/50 hover:border-border transition-colors">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("settings.aboutSupportTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.aboutSupportDescription")}</p>
          </div>
          <Button
            variant="default"
            onClick={handleOpenSupportLink}
            className="shadow-[0_0_15px_rgba(var(--primary),0.25)] hover:shadow-[0_0_25px_rgba(var(--primary),0.45)]"
          >
            {t("settings.aboutSupportAction")}
            <ExternalLink className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    </div>
  );
}
