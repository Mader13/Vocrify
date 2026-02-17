import { Settings } from "lucide-react";
import { useTasks } from "@/stores";
import type { ArchiveMode } from "@/types";
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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Archive Settings
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Configure default behavior for archiving transcriptions
        </p>
      </div>

      <div className="space-y-3">
        <label className="text-sm font-medium">Default Archive Mode:</label>
        <div className="grid grid-cols-1 gap-2">
          {[
            { value: "keep_all", label: "Keep All", desc: "Don't delete any files" },
            { value: "delete_video", label: "Delete Video", desc: "Delete video, keep audio" },
            { value: "text_only", label: "Text Only", desc: "Delete all media files" },
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
            <div className="text-sm font-medium">Remember Choice</div>
            <div className="text-xs text-muted-foreground">
              Use selected mode for all future archives
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
            <div className="text-sm font-medium">Show File Sizes</div>
            <div className="text-xs text-muted-foreground">
              Display file size and potential space savings
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
