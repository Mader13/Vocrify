import { Cpu, Languages, Layers } from "lucide-react";
import { Select } from "@/components/ui";
import { useTasks } from "@/stores";
import { DEVICE_NAMES, LANGUAGE_NAMES } from "@/types";
import type { DeviceType, Language } from "@/types";
import { useI18n } from "@/hooks";

export function TranscriptionTab() {
  const settings = useTasks((s) => s.settings);
  const updateSettings = useTasks((s) => s.updateSettings);
  const { t } = useI18n();

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ defaultDevice: e.target.value as DeviceType });
  };

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ defaultLanguage: e.target.value as Language });
  };

  const handleMaxConcurrentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ maxConcurrentTasks: parseInt(e.target.value, 10) });
  };

  return (
    <div className="space-y-8 h-full flex flex-col">
      <div>
        <h2 className="text-2xl font-semibold mb-1">{t("settings.transcriptionTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.transcriptionDescription")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="device" className="text-sm font-medium flex items-center gap-2">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            {t("settings.computeDevice")}
          </label>
          <Select
            id="device"
            value={settings.defaultDevice}
            onChange={handleDeviceChange}
            className="bg-background/80 dark:bg-background/50 backdrop-blur-sm border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20 transition-colors"
          >
            {Object.entries(DEVICE_NAMES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <label htmlFor="language" className="text-sm font-medium flex items-center gap-2">
            <Languages className="h-4 w-4 text-muted-foreground" />
            {t("settings.defaultLanguage")}
          </label>
          <Select
            id="language"
            value={settings.defaultLanguage}
            onChange={handleLanguageChange}
            className="bg-background/80 dark:bg-background/50 backdrop-blur-sm border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20 transition-colors"
          >
            {Object.entries(LANGUAGE_NAMES).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="max-concurrent" className="text-sm font-medium flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          {t("settings.concurrentTasks")}
        </label>
        <Select
          id="max-concurrent"
          value={settings.maxConcurrentTasks.toString()}
          onChange={handleMaxConcurrentChange}
          className="w-32 bg-background/80 dark:bg-background/50 backdrop-blur-sm border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20 transition-colors"
        >
          {[1, 2, 3, 4].map((num) => (
            <option key={num} value={num}>
              {num}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground mt-2">{t("settings.concurrentTasksHint")}</p>
      </div>
    </div>
  );
}
