import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button, Dialog, DialogContent, DialogClose, DialogFooter } from "@/components/ui";
import { useUIStore, useSetupStore } from "@/stores";
import { SettingsNav } from "./settings/SettingsNav";
import { TranscriptionTab } from "./settings/TranscriptionTab";
import { SystemStatusTab } from "./settings/SystemStatusTab";
import { AdvancedTab } from "./settings/AdvancedTab";
import { AcknowledgmentsTab } from "./settings/AcknowledgmentsTab";
import { AboutTab } from "./settings/AboutTab";
import { RerunSetupDialog } from "./settings/RerunSetupDialog";
import type { TabId } from "./settings/SettingsNav";
import { useI18n } from "@/hooks";

export function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<TabId>("transcription");
  const [isRerunSetupDialogOpen, setIsRerunSetupDialogOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const isSettingsOpen = useUIStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const { checkAll, fetchDevices, ffmpegCheck, pythonCheck, resetSetupState } = useSetupStore();
  const { t } = useI18n();

  useEffect(() => {
    if (!isSettingsOpen) return;
    if (!ffmpegCheck || !pythonCheck) checkAll();
    fetchDevices(false);
  }, [isSettingsOpen, ffmpegCheck, pythonCheck, checkAll, fetchDevices]);

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (isRerunSetupDialogOpen) return;
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    },
    [setSettingsOpen, isRerunSetupDialogOpen],
  );

  useEffect(() => {
    if (!isSettingsOpen) return;
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isSettingsOpen, handleClickOutside]);

  const handleRerunSetup = async () => {
    await resetSetupState();
    const { isComplete, error } = useSetupStore.getState();

    if (error || isComplete) {
      return;
    }

    setIsRerunSetupDialogOpen(false);
    setSettingsOpen(false);
  };

  return (
    <>
      <Dialog open={isSettingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent
          ref={panelRef}
          className="max-w-4xl max-h-[90vh] overflow-hidden p-0 bg-background/90 dark:bg-background/40 backdrop-blur-[40px] border-border/50 dark:border-white/5 shadow-2xl shadow-black/40 sm:rounded-[2rem]"
        >
          <div className="flex h-[600px] sm:h-[700px] max-h-[85vh] w-full">
            <SettingsNav activeTab={activeTab} onTabChange={setActiveTab} />

            <div className="flex-1 relative overflow-hidden flex flex-col">
              <DialogClose
                className="absolute top-6 right-6 z-50 rounded-full bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/20 p-2 backdrop-blur-md border border-white/10 transition-colors"
                onClick={() => setSettingsOpen(false)}
              />

              <div className="flex-1 overflow-y-auto px-8 py-8 my-4 mx-1 relative">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, scale: 0.98, filter: "blur(8px)" }}
                    animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, scale: 0.98, filter: "blur(4px)" }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="space-y-8 h-full"
                  >
                    {activeTab === "transcription" && <TranscriptionTab />}
                    {activeTab === "system" && <SystemStatusTab onRerunSetupClick={() => setIsRerunSetupDialogOpen(true)} />}
                    {activeTab === "advanced" && <AdvancedTab />}
                    {activeTab === "about" && <AboutTab />}
                    {activeTab === "acknowledgments" && <AcknowledgmentsTab />}
                  </motion.div>
                </AnimatePresence>
              </div>

              <DialogFooter className="px-8 py-4 border-t border-border/20 bg-background/20 backdrop-blur-lg">
                <Button
                  onClick={() => setSettingsOpen(false)}
                  className="ml-auto shadow-[0_0_15px_rgba(var(--primary),0.3)] hover:shadow-[0_0_25px_rgba(var(--primary),0.5)] transition-shadow"
                >
                  {t("common.saveAndClose")}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <RerunSetupDialog
        isOpen={isRerunSetupDialogOpen}
        onCancel={() => setIsRerunSetupDialogOpen(false)}
        onConfirm={handleRerunSetup}
      />
    </>
  );
}
