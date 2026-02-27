import { Heart, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/hooks";
import {
  groupedAcknowledgments,
  categoryColors,
  categoryHoverColors,
  categoryLabels,
  type AcknowledgmentCategory,
} from "./acknowledgments";

export function AcknowledgmentsTab() {
  const { t } = useI18n();
  return (
    <div className="space-y-8 h-full flex flex-col pb-6">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2 mb-1">{t("settings.acknowledgmentsTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.acknowledgmentsDescription")}
        </p>
      </div>

      <div className="space-y-6">
        <div className="p-4 rounded-2xl border border-destructive/35 bg-destructive/10 flex-shrink-0">
          <p className="text-center text-sm text-destructive dark:text-destructive/85">
            <Heart className="h-4 w-4 inline mr-1.5 -mt-0.5" />
            {t("settings.acknowledgmentsThankYou")}
            <Heart className="h-4 w-4 inline ml-1.5 -mt-0.5" />
          </p>
        </div>

        <div className="space-y-8">
          {Object.entries(groupedAcknowledgments).map(([category, items]) => {
            const colors = categoryColors[category as AcknowledgmentCategory];
            const hoverColors = categoryHoverColors[category as AcknowledgmentCategory];
            return (
              <div key={category} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={cn("px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-sm border", colors.bg, colors.border, colors.text)}>
                    {categoryLabels[category as AcknowledgmentCategory]}
                  </span>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {items.map((item) => (
                    <a
                      key={item.name}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn("flex items-start gap-4 p-4 rounded-2xl border bg-black/5 dark:bg-white/5 transition-all duration-300 group", colors.border, hoverColors)}
                    >
                      <div className={cn("p-2.5 rounded-xl transition-colors", colors.bg, colors.text)}>
                        <item.Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm group-hover:text-primary transition-colors">{item.name}</span>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
