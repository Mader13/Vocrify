import { Settings2, HardDrive, AlertTriangle, Heart, Sun, Moon, Monitor, BadgeInfo } from "lucide-react";
import { motion, LayoutGroup } from "framer-motion";
import { DialogHeader, DialogTitle, DialogDescription, Select } from "@/components/ui";
import { useTasks } from "@/stores";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks";
import { APP_LOCALE_NAMES, type AppLocale } from "@/types";

export type TabId = "transcription" | "system" | "advanced" | "acknowledgments" | "about";

const THEMES = ["light", "dark", "system"] as const;
type Theme = (typeof THEMES)[number];

const THEME_ICONS: Record<Theme, React.ComponentType<{ className?: string }>> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

interface SettingsNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function SettingsNav({ activeTab, onTabChange }: SettingsNavProps) {
  const settings = useTasks((s) => s.settings);
  const updateSettings = useTasks((s) => s.updateSettings);
  const { t } = useI18n();

  const handleDisplayLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ language: event.target.value as AppLocale });
  };

  const tabs: { id: TabId; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "transcription", label: t("settings.navTranscription"), Icon: Settings2 },
    { id: "system", label: t("settings.navSystem"), Icon: HardDrive },
    { id: "advanced", label: t("settings.navAdvanced"), Icon: AlertTriangle },
    { id: "about", label: t("settings.navAbout"), Icon: BadgeInfo },
    { id: "acknowledgments", label: t("settings.navAcknowledgments"), Icon: Heart },
  ];

  const themeTitles: Record<Theme, string> = {
    light: t("settings.themeLight"),
    dark: t("settings.themeDark"),
    system: t("settings.themeSystem"),
  };

  return (
    <div className="w-64 border-r border-border/20 bg-muted/40 dark:bg-muted/10 p-6 flex flex-col justify-between">
      <div>
        <DialogHeader className="mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/20 backdrop-blur-md border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.2)]">
              <Settings2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-xl">{t("settings.title")}</DialogTitle>
              <DialogDescription className="text-xs">{t("settings.subtitle")}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <LayoutGroup>
          <nav className="space-y-1.5 flex flex-col relative w-full flex-1">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    "relative w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 group text-left",
                    isActive
                      ? "text-primary shadow-[0_0_10px_rgba(var(--primary),0.1)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5",
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeTabIndicator"
                      className="absolute inset-0 bg-primary/10 border border-primary/20 rounded-xl"
                      transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-3">
                    <tab.Icon
                      className={cn(
                        "h-4 w-4 transition-transform duration-200",
                        isActive
                          ? "scale-110"
                          : tab.id === "acknowledgments"
                            ? "group-hover:scale-110 group-hover:text-rose-500"
                            : "group-hover:scale-110",
                      )}
                    />
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </nav>
        </LayoutGroup>
      </div>

      <div className="space-y-4 mt-8">
        <div className="space-y-2">
          <label htmlFor="display-language-nav" className="text-xs font-medium text-muted-foreground px-2">
            {t("settings.displayLanguage")}
          </label>
          <Select
            id="display-language-nav"
            value={settings.language}
            onChange={handleDisplayLanguageChange}
            className="h-9 bg-background/80 dark:bg-background/50 backdrop-blur-sm border-border/50 dark:border-white/10 hover:border-border dark:hover:border-white/20 transition-colors"
          >
            {Object.entries(APP_LOCALE_NAMES).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </Select>
        </div>

        <label className="text-xs font-medium text-muted-foreground px-2">{t("settings.theme")}</label>
        <div className="flex items-center p-1 bg-black/5 dark:bg-white/5 border border-border/50 rounded-xl">
          {THEMES.map((theme) => {
            const Icon = THEME_ICONS[theme];
            const isActive = settings.theme === theme;
            return (
              <button
                key={theme}
                onClick={() => updateSettings({ theme })}
                className={cn(
                  "relative flex-1 flex justify-center py-2 rounded-lg transition-all duration-300",
                  isActive
                    ? "text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5",
                )}
                title={themeTitles[theme]}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeThemeIndicator"
                    className="absolute inset-0 bg-primary rounded-lg shadow-[0_4px_12px_rgba(15,23,42,0.3)]"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <Icon className={cn("h-4 w-4 relative z-10 transition-transform duration-200", isActive && "scale-110")} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
