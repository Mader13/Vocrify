import { Settings, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTasks } from "@/stores";
import type { ArchiveMode } from "@/types";
import { DEFAULT_ARCHIVE_SETTINGS } from "@/types";
import { cn } from "@/lib/utils";

export function ArchiveSettingsPanel() {
  const archiveSettings = useTasks((s) => s.archiveSettings);
  const setArchiveSettings = useTasks((s) => s.setArchiveSettings);

  const handleModeChange = (mode: ArchiveMode) => {
    setArchiveSettings({ defaultMode: mode });
  };

  const handleToggle = (key: "rememberChoice" | "showFileSizes") => {
    setArchiveSettings({ [key]: !archiveSettings[key] });
  };

  const handleReset = () => {
    setArchiveSettings(DEFAULT_ARCHIVE_SETTINGS);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Настройки архивации
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Настройте поведение по умолчанию при архивации транскрипций
        </p>
      </div>

      <div className="space-y-3">
        <label className="text-sm font-medium">Режим архивации по умолчанию:</label>
        <div className="grid grid-cols-1 gap-2">
          {[
            { value: "keep_all", label: "Оставить всё", desc: "Не удалять никакие файлы" },
            { value: "delete_video", label: "Удалить видео", desc: "Удалить видео, оставить аудио" },
            { value: "text_only", label: "Только текст", desc: "Удалить все медиафайлы" },
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

      <div className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={archiveSettings.rememberChoice}
            onChange={() => handleToggle("rememberChoice")}
            className="rounded"
          />
          <div>
            <div className="text-sm font-medium">Запоминать выбор</div>
            <div className="text-xs text-muted-foreground">
              Использовать выбранный режим для всех будущих архиваций
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
            <div className="text-sm font-medium">Показывать размер файлов</div>
            <div className="text-xs text-muted-foreground">
              Отображать размер файла и потенциальную экономию места
            </div>
          </div>
        </label>
      </div>

      <Button variant="outline" onClick={handleReset} className="gap-2">
        <RotateCcw className="h-4 w-4" />
        Сбросить настройки
      </Button>
    </div>
  );
}
