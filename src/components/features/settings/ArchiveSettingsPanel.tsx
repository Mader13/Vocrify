import { Settings } from "lucide-react";
import { useTasks } from "@/stores";
import { useI18n } from "@/hooks";
import type { ArchiveMode, ArchiveCompression } from "@/types";
import { ARCHIVE_COMPRESSION_LABELS } from "@/types";
import { cn } from "@/lib/utils";

export function ArchiveSettingsPanel() {
  const { t } = useI18n();
  const archiveSettings = useTasks((s) => s.archiveSettings);
  const setArchiveSettings = useTasks((s) => s.setArchiveSettings);

  const handleModeChange = (mode: ArchiveMode) => {
    setArchiveSettings({ defaultMode: mode });
  };

  const handleCompressionChange = (compression: ArchiveCompression) => {
    setArchiveSettings({ compression });
  };

  const handleToggle = (key: "rememberChoice" | "showFileSizes") => {
    setArchiveSettings({ [key]: !archiveSettings[key] });
  };

  const compressionOptions: { value: ArchiveCompression; label: string; desc: string }[] = [
    { value: "none", label: t("settings.archiveNoCompression"), desc: t("settings.archiveNoCompressionDesc") },
    { value: "light", label: t("settings.archiveLight"), desc: t("settings.archiveLightDesc") },
    { value: "medium", label: t("settings.archiveMedium"), desc: t("settings.archiveMediumDesc") },
    { value: "heavy", label: t("settings.archiveHeavy"), desc: t("settings.archiveHeavyDesc") },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Settings className="h-5 w-5" />
          {t("settings.archiveTitle")}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t("settings.archiveDescription")}
        </p>
      </div>

      <div className="space-y-3">
        <label className="text-sm font-medium">{t("settings.archiveDefaultMode")}</label>
        <div className="grid grid-cols-1 gap-2">
          {[
            { value: "keep_all", label: t("settings.archiveKeepAll"), desc: t("settings.archiveKeepAllDesc") },
            { value: "delete_video", label: t("settings.archiveDeleteVideo"), desc: t("settings.archiveDeleteVideoDesc") },
            { value: "text_only", label: t("settings.archiveTextOnly"), desc: t("settings.archiveTextOnlyDesc") },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => handleModeChange(option.value as ArchiveMode)}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                archiveSettings.defaultMode === option.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              )}
            >
              <div
                className={cn(
                  "h-4 w-4 rounded-full border-2 shrink-0",
                  archiveSettings.defaultMode === option.value
                    ? "border-primary bg-primary"
                    : "border-muted-foreground"
                )}
              />
              <div>
                <div className="font-medium text-sm">{option.label}</div>
                <div className="text-xs text-muted-foreground">{option.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <label className="text-sm font-medium">{t("settings.archiveCompression")}</label>
        <div className="grid grid-cols-2 gap-2">
          {compressionOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => handleCompressionChange(option.value)}
              className={cn(
                "flex items-center gap-2 p-2 rounded-lg border text-left transition-all text-sm",
                archiveSettings.compression === option.value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/30"
              )}
            >
              <div
                className={cn(
                  "h-3 w-3 rounded-full border-2 shrink-0",
                  archiveSettings.compression === option.value
                    ? "border-primary bg-primary"
                    : "border-muted-foreground"
                )}
              />
              <div>
                <div className="font-medium">{option.label}</div>
              </div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {ARCHIVE_COMPRESSION_LABELS[archiveSettings.compression]}
        </p>
      </div>

      <div className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={archiveSettings.rememberChoice}
            onChange={() => handleToggle("rememberChoice")}
            className="rounded"
          />
          <div>
            <div className="text-sm font-medium">{t("settings.archiveRememberChoice")}</div>
            <div className="text-xs text-muted-foreground">
              {t("settings.archiveRememberChoiceDesc")}
            </div>
          </div>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={archiveSettings.showFileSizes}
            onChange={() => handleToggle("showFileSizes")}
            className="rounded"
          />
          <div>
            <div className="text-sm font-medium">{t("settings.archiveShowFileSizes")}</div>
            <div className="text-xs text-muted-foreground">
              {t("settings.archiveShowFileSizesDesc")}
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
