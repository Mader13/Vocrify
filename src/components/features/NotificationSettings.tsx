import { Bell, Volume2, Monitor, Download, FileText, AlertCircle, Info, Play } from "lucide-react";
import { Switch, Select, Slider, Button } from "@/components/ui";
import { useNotificationStore } from "@/services/notifications";
import {
  NOTIFICATION_POSITION_LABELS,
  NOTIFICATION_CATEGORY_LABELS,
  NOTIFICATION_CATEGORY_ICONS,
  type NotificationPosition,
  type NotificationDuration,
  type NotificationCategory,
} from "@/types";
import { cn } from "@/lib/utils";

export function NotificationSettings() {
  const { settings, updateSettings, addNotification } = useNotificationStore();

  const handlePositionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ position: e.target.value as NotificationPosition });
  };

  const handleDurationChange = (value: number) => {
    // Convert 0-100 slider to: 0 = infinite, 1-100 = 2-10 seconds
    const duration: NotificationDuration = value === 0 ? "infinite" : 2 + (value / 100) * 8;
    updateSettings({ duration });
  };

  const handleCategoryToggle = (category: NotificationCategory, enabled: boolean) => {
    updateSettings({
      categories: {
        ...settings.categories,
        [category]: enabled,
      },
    });
  };

  const handleTestNotification = () => {
    addNotification({
      title: "Test Notification",
      message: "This is an example of how your notifications will look",
      type: "success",
      category: "info",
    });
  };

  // Convert duration back to slider value
  const sliderValue = settings.duration === "infinite" ? 0 : ((settings.duration as number) - 2) / 8 * 100;
  const durationDisplay = settings.duration === "infinite" ? "Until dismissed" : `${Math.round(settings.duration as number)}s`;

  return (
    <div className="space-y-6">
      {/* Master Toggle */}
      <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-primary/10">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-medium">Notifications</h3>
            <p className="text-sm text-muted-foreground">
              {settings.enabled ? "Notifications enabled" : "Notifications disabled"}
            </p>
          </div>
        </div>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(checked) => updateSettings({ enabled: checked })}
        />
      </div>

      {/* Position Settings */}
      <div className={cn("space-y-3 transition-all", !settings.enabled && "opacity-50 pointer-events-none")}>
        <label className="text-sm font-medium">Notification Position</label>
        <Select
          value={settings.position}
          onChange={handlePositionChange}
        >
          {(Object.entries(NOTIFICATION_POSITION_LABELS) as [NotificationPosition, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            )
          )}
        </Select>
        <p className="text-xs text-muted-foreground">
          Choose where to display notifications on screen
        </p>
      </div>

      {/* Duration Settings */}
      <div className={cn("space-y-3 transition-all", !settings.enabled && "opacity-50 pointer-events-none")}>
        <label className="text-sm font-medium">Display Duration</label>
        <Slider
          value={sliderValue}
          onValueChange={handleDurationChange}
          min={0}
          max={100}
          step={1}
          showValue
          valueFormatter={() => durationDisplay}
        />
        <p className="text-xs text-muted-foreground">
          {settings.duration === "infinite"
            ? "Notifications will stay until manually dismissed"
            : `Notifications auto-hide after ${settings.duration} seconds`}
        </p>
      </div>

      {/* Sound Settings */}
      <div className={cn("space-y-3 transition-all", !settings.enabled && "opacity-50 pointer-events-none")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Volume2 className="h-5 w-5 text-muted-foreground" />
            <div>
              <label className="text-sm font-medium">Notification Sound</label>
              <p className="text-xs text-muted-foreground">
                Play sound when notifications appear
              </p>
            </div>
          </div>
          <Switch
            checked={settings.soundEnabled}
            onCheckedChange={(checked) => updateSettings({ soundEnabled: checked })}
          />
        </div>
      </div>

      {/* Desktop Notifications */}
      <div className={cn("space-y-3 transition-all", !settings.enabled && "opacity-50 pointer-events-none")}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Monitor className="h-5 w-5 text-muted-foreground" />
            <div>
              <label className="text-sm font-medium">System Notifications</label>
              <p className="text-xs text-muted-foreground">
                Use native operating system notifications
              </p>
            </div>
          </div>
          <Switch
            checked={settings.desktopNotificationsEnabled}
            onCheckedChange={(checked) => updateSettings({ desktopNotificationsEnabled: checked })}
          />
        </div>
      </div>

      {/* Category Toggles */}
      <div className={cn("space-y-3 transition-all", !settings.enabled && "opacity-50 pointer-events-none")}>
        <label className="text-sm font-medium">Notification Categories</label>
        <div className="space-y-2">
          {(Object.entries(NOTIFICATION_CATEGORY_LABELS) as [NotificationCategory, string][]).map(
            ([category, label]) => {
              const IconName = NOTIFICATION_CATEGORY_ICONS[category];
              return (
                <div
                  key={category}
                  className="flex items-center justify-between p-3 rounded-md border bg-card/50 hover:bg-card transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {IconName === "Download" && <Download className="h-4 w-4 text-muted-foreground" />}
                    {IconName === "FileText" && <FileText className="h-4 w-4 text-muted-foreground" />}
                    {IconName === "AlertCircle" && <AlertCircle className="h-4 w-4 text-destructive" />}
                    {IconName === "Info" && <Info className="h-4 w-4 text-muted-foreground" />}
                    <span className="text-sm">{label}</span>
                  </div>
                  <Switch
                    checked={settings.categories[category]}
                    onCheckedChange={(checked) => handleCategoryToggle(category, checked)}
                  />
                </div>
              );
            }
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Choose which events should show notifications
        </p>
      </div>

      {/* Test Notification */}
      <div className={cn("pt-4 border-t transition-all", !settings.enabled && "opacity-50 pointer-events-none")}>
        <Button
          variant="outline"
          onClick={handleTestNotification}
          className="w-full"
        >
          <Play className="h-4 w-4 mr-2" />
          Test Notification
        </Button>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Show a test notification with current settings
        </p>
      </div>
    </div>
  );
}
