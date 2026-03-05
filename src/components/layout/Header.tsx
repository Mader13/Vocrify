import { useState } from "react";
import { Settings, Mic, Database, Archive, Power, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useI18n } from "@/hooks";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { hasActiveWorkNow, quitApplication } from "@/services/tauri";
import { logger } from "@/lib/logger";

export function Header() {
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const currentView = useUIStore((s) => s.currentView);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const { t } = useI18n();
  const [isExitDialogOpen, setIsExitDialogOpen] = useState(false);
  const [hasActiveTranscriptions, setHasActiveTranscriptions] = useState(false);
  const [isCheckingActiveWork, setIsCheckingActiveWork] = useState(false);
  const [isQuitting, setIsQuitting] = useState(false);

  async function handleOpenExitDialog() {
    setIsCheckingActiveWork(true);
    const activeWorkResult = await hasActiveWorkNow();
    setHasActiveTranscriptions(Boolean(activeWorkResult.data));
    if (!activeWorkResult.success) {
      logger.error("Failed to check active transcriptions before app quit", {
        error: activeWorkResult.error,
      });
    }
    setIsCheckingActiveWork(false);
    setIsExitDialogOpen(true);
  }

  async function handleConfirmQuit() {
    setIsQuitting(true);
    const result = await quitApplication();
    if (!result.success) {
      logger.error("Failed to quit application from header", {
        error: result.error,
      });
      setIsQuitting(false);
      setIsExitDialogOpen(false);
    }
  }

  const tabs = [
    { id: "transcription", label: t("header.transcription"), icon: Mic },
    { id: "archive", label: t("header.archive"), icon: Archive },
    { id: "models", label: t("header.models"), icon: Database },
  ] as const;

  return (
    <>
      {/* Floating Header */}
      <motion.header 
        initial={{ y: -50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex h-14 items-center justify-between rounded-full border border-border/50 bg-background/60 px-6 backdrop-blur-xl shadow-2xl w-[calc(100%-2rem)] max-w-5xl"
      >
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold bg-linear-to-r from-primary to-primary/70 bg-clip-text text-transparent drop-shadow-sm">Vocrify</h1>

          <nav className="flex items-center gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentView === tab.id;

              return (
                <button
                  key={tab.id}
                  onClick={() => setCurrentView(tab.id as "transcription" | "archive" | "models")}
                  className={cn(
                    "group relative flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="header-active-tab"
                      className="absolute inset-0 rounded-full bg-primary/10"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  <Icon className={cn("h-4 w-4 relative z-10 transition-transform duration-200", isActive ? "scale-110" : "group-hover:scale-110")} />
                  <span className="relative z-10 hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          

          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full hover:bg-primary/10 hover:text-primary transition-colors"
              onClick={() => setSettingsOpen(true)}
              title={t("header.openSettings")}
              aria-label={t("header.openSettings")}
            >
              <Settings className="h-5 w-5" />
            </Button>
          </motion.div>

          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full hover:bg-destructive/10 hover:text-destructive transition-colors"
              onClick={handleOpenExitDialog}
              title={t("header.quitApp")}
              aria-label={t("header.quitApp")}
              disabled={isCheckingActiveWork || isQuitting}
            >
              {isCheckingActiveWork ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Power className="h-5 w-5" />
              )}
            </Button>
          </motion.div>
        </div>
      </motion.header>

      <AlertDialog open={isExitDialogOpen} onOpenChange={setIsExitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("header.quitConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("header.quitConfirmDescription")}
            </AlertDialogDescription>
            {hasActiveTranscriptions ? (
              <AlertDialogDescription className="text-destructive font-medium pt-2">
                {t("header.quitActiveTranscriptionsWarning")}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmQuit}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isQuitting}
            >
              {t("header.quitConfirmAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
