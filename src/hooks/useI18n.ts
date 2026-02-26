import { useMemo } from "react";
import { useTasks } from "@/stores";
import { normalizeLocale, translate, type I18nKey, type I18nLocale } from "@/i18n";

export function useI18n() {
  const language = useTasks((s) => s.settings.language);

  const locale = normalizeLocale(language);

  const t = useMemo(() => {
    return (key: I18nKey) => translate(locale, key);
  }, [locale]);

  return {
    locale: locale as I18nLocale,
    t,
  };
}
