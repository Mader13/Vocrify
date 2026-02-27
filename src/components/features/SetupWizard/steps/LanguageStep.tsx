import { useI18n } from "@/hooks";
import { useSettingsActions, useSetting } from "@/stores/settingsStore";
import { Button } from "@/components/ui/button";
import { Globe, Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { AppLocale } from "@/types";

export function LanguageStep() {
  const language = useSetting("language");
  const { updateSettings } = useSettingsActions();

  const handleLanguageSelect = (lang: AppLocale) => {
    updateSettings({ language: lang });
  };

  return (
    <div className="space-y-8 py-4">
      <div className="text-center space-y-3 mb-10">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className="mx-auto w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-6 shadow-sm"
        >
          <Globe className="w-8 h-8" />
        </motion.div>
        <h3 className="text-3xl font-bold tracking-tight">Welcome / Добро пожаловать</h3>
        <p className="text-muted-foreground text-lg">
          Please select your preferred language to continue.
          <br />
          Пожалуйста, выберите предпочитаемый язык для продолжения.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-lg mx-auto">
        <motion.button
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => handleLanguageSelect("en")}
          className={cn(
            "relative flex flex-col items-center p-8 rounded-2xl border-2 transition-all duration-200",
            "hover:border-primary/50 hover:bg-muted/50 hover:shadow-md",
            language === "en" 
              ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20" 
              : "border-border bg-card"
          )}
        >
          {language === "en" && (
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute top-4 right-4 text-primary bg-primary/10 p-1 rounded-full"
            >
              <Check className="w-5 h-5" />
            </motion.div>
          )}
          <span className="text-5xl mb-4 drop-shadow-sm">🇺🇸</span>
          <span className="font-semibold text-xl">English</span>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.02, y: -2 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => handleLanguageSelect("ru")}
          className={cn(
            "relative flex flex-col items-center p-8 rounded-2xl border-2 transition-all duration-200",
            "hover:border-primary/50 hover:bg-muted/50 hover:shadow-md",
            language === "ru" 
              ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20" 
              : "border-border bg-card"
          )}
        >
          {language === "ru" && (
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute top-4 right-4 text-primary bg-primary/10 p-1 rounded-full"
            >
              <Check className="w-5 h-5" />
            </motion.div>
          )}
          <span className="text-5xl mb-4 drop-shadow-sm">🇷🇺</span>
          <span className="font-semibold text-xl">Русский</span>
        </motion.button>
      </div>
    </div>
  );
}

export function LanguageStepFooter({ onNext }: { onNext: () => void }) {
  const { t } = useI18n();
  
  return (
    <div className="flex justify-end w-full">
      <Button onClick={onNext} size="lg" className="min-w-[140px] font-medium shadow-sm">
        {t("common.continue")}
      </Button>
    </div>
  );
}

