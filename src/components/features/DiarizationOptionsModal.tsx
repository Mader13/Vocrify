import React, { useState, useEffect } from "react";
import { Check, Info, Users, ArrowRight, DownloadCloud, Sparkles, SlidersHorizontal } from "lucide-react";
import { DiarizationProvider, LANGUAGE_NAMES, type Language, type AudioProfile } from "@/types";
import { formatFileSize, cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUIStore } from "@/stores";
import { useI18n } from "@/hooks";
import { motion, AnimatePresence } from "framer-motion";

export type SpeakerCount = "auto" | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface FileWithSettings {
  id: string;
  name: string;
  path: string;
  size: number;
  enableDiarization: boolean;
  diarizationProvider: DiarizationProvider | null;
  numSpeakers: SpeakerCount;
  language: Language | null;
  audioProfile: AudioProfile;
}

export interface DiarizationOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (filesWithSettings: FileWithSettings[], rememberChoice: boolean) => void;
  files: Array<{ path: string; name: string; size: number }>;
  availableDiarizationProviders: DiarizationProvider[];
  lastUsedProvider: DiarizationProvider;
  lastUsedEnableDiarization: boolean;
  defaultLanguage: Language;
}

export const DiarizationOptionsModal: React.FC<DiarizationOptionsModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  files,
  availableDiarizationProviders,
  lastUsedEnableDiarization,
  defaultLanguage,
}) => {
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  const setModelsActiveTab = useUIStore((s) => s.setModelsActiveTab);
  const { t } = useI18n();
  
  const [filesWithSettings, setFilesWithSettings] = useState<FileWithSettings[]>([]);
  const [rememberChoice, setRememberChoice] = useState(false);

  const hasProviders = availableDiarizationProviders.length > 0;
  const defaultProvider = hasProviders ? availableDiarizationProviders[0] : null;

  useEffect(() => {
    if (isOpen && files.length > 0) {
      setFilesWithSettings(
        files.map((file) => ({
          id: `${file.path}-${Date.now()}-${Math.random()}`,
          name: file.name,
          path: file.path,
          size: file.size,
          enableDiarization: hasProviders ? lastUsedEnableDiarization : false,
          diarizationProvider: hasProviders ? defaultProvider : null,
          numSpeakers: 'auto' as SpeakerCount,
          language: null,
          audioProfile: "standard" as AudioProfile,
        }))
      );
    }
  }, [isOpen, files, hasProviders, defaultProvider, lastUsedEnableDiarization]);

  const handleToggleDiarization = (fileId: string, enabled: boolean) => {
    setFilesWithSettings((prev) =>
      prev.map((file) =>
        file.id === fileId
          ? {
              ...file,
              enableDiarization: enabled,
              diarizationProvider: enabled ? defaultProvider : null,
            }
          : file
      )
    );
  };

  const handleSpeakerCountChange = (fileId: string, count: SpeakerCount) => {
    setFilesWithSettings((prev) =>
      prev.map((file) =>
        file.id === fileId ? { ...file, numSpeakers: count } : file
      )
    );
  };

  const handleLanguageChange = (language: Language | null) => {
    setFilesWithSettings((prev) =>
      prev.map((file) => ({ ...file, language }))
    );
  };

  const handleAudioProfileChange = (audioProfile: AudioProfile) => {
    setFilesWithSettings((prev) =>
      prev.map((file) => ({ ...file, audioProfile }))
    );
  };

  const handleConfirm = () => {
    onConfirm(filesWithSettings, rememberChoice);
    onClose();
  };

  const handleGoToModels = () => {
    setCurrentView("models");
    setModelsActiveTab("diarization");
    onClose();
  };

  const activeFile = filesWithSettings[0];
  const isNoisyAudioProfile = (filesWithSettings[0]?.audioProfile ?? "standard") === "noisy";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="max-w-[640px] p-0 overflow-hidden border-border/40 bg-background/80 shadow-2xl backdrop-blur-2xl rounded-2xl sm:rounded-[24px]"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t("diarization.title")}</DialogTitle>
        {/* Header - Glassmorphic */}
        <div className="relative border-b border-border/40 bg-card/30 px-6 sm:px-8 py-6">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-60 pointer-events-none" />
          <div className="relative">
             <h2 className="text-[22px] font-bold tracking-tight text-foreground flex items-center gap-2.5">
               <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                 <Sparkles className="w-4 h-4 text-primary" />
               </div>
               {t("diarization.title")}
             </h2>
             {activeFile && (
               <p className="text-[15px] text-muted-foreground mt-2 flex items-center gap-2">
                 <span className="font-medium text-foreground/80 truncate max-w-[280px] sm:max-w-[360px]">{activeFile.name}</span>
                 <span className="text-border/60">•</span>
                 <span>{formatFileSize(activeFile.size)}</span>
                 {filesWithSettings.length > 1 && (
                    <>
                      <span className="text-border/60">•</span>
                      <span className="bg-primary/10 text-primary px-2.5 py-0.5 rounded-full text-[13px] font-semibold tracking-wide">
                        +{filesWithSettings.length - 1} {t("diarization.more")}
                      </span>
                    </>
                 )}
               </p>
             )}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="max-h-[60vh] overflow-y-auto p-6 sm:p-8 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border/40">
           <div className="space-y-6">
             {filesWithSettings.length > 0 && (
               <div className="rounded-2xl border border-border/40 bg-muted/10 p-5 sm:p-6">
                 <label className="text-[14px] font-medium text-foreground mb-3 flex items-center justify-between">
                   <span>{t("diarization.spokenLanguage")}</span>
                   <span className="text-[12px] text-muted-foreground">{t("diarization.defaultFromSettings")} {LANGUAGE_NAMES[defaultLanguage]}</span>
                 </label>
                 <div className="rounded-xl border border-border/60 bg-muted/20 p-1.5 shadow-inner">
                   <select
                     value={filesWithSettings[0]?.language ?? "default"}
                     onChange={(event) =>
                       handleLanguageChange(
                         event.target.value === "default"
                           ? null
                           : (event.target.value as Language)
                       )
                     }
                     className="h-11 w-full rounded-lg border border-transparent bg-background/80 px-3 text-[14px] font-medium text-foreground outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
                   >
                     <option value="default">{t("diarization.useDefault")}</option>
                     {Object.entries(LANGUAGE_NAMES).map(([key, label]) => (
                       <option key={key} value={key}>
                         {label}
                       </option>
                     ))}
                   </select>
                 </div>
               </div>
             )}

             {filesWithSettings.length > 0 && (
               <div
                 className={cn(
                   "group rounded-2xl border transition-all duration-300 overflow-hidden mt-6",
                   isNoisyAudioProfile
                     ? "bg-card border-primary/30 shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] shadow-primary/5"
                     : "bg-muted/10 border-border/40 hover:border-border/60 hover:bg-muted/30"
                 )}
               >
                 <div
                   className="p-5 sm:p-6 flex items-center justify-between gap-4 cursor-pointer"
                   onClick={() =>
                     handleAudioProfileChange(
                       isNoisyAudioProfile ? "standard" : "noisy"
                     )
                   }
                 >
                   <div className="flex items-center gap-4">
                     <div
                       className={cn(
                         "w-12 h-12 rounded-xl flex items-center justify-center transition-colors duration-300",
                         isNoisyAudioProfile
                           ? "bg-primary text-primary-foreground shadow-inner shadow-primary-foreground/20"
                           : "bg-muted text-muted-foreground"
                       )}
                     >
                       <SlidersHorizontal className="w-5 h-5" />
                     </div>
                     <div>
                       <h4
                         className={cn(
                           "text-[16px] font-semibold transition-colors duration-300",
                           isNoisyAudioProfile
                             ? "text-foreground"
                             : "text-muted-foreground"
                         )}
                        >
                          {t("diarization.noisyWindyLabel")}
                        </h4>
                        <p className="text-[13.5px] text-muted-foreground mt-1">
                          {t("diarization.noisyWindyDescription")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={isNoisyAudioProfile}
                       onCheckedChange={(checked) =>
                         handleAudioProfileChange(
                           checked ? "noisy" : "standard"
                         )
                       }
                       className="data-[state=checked]:bg-primary"
                     />
                   </div>
                 </div>
               </div>
             )}

             {!hasProviders ? (
             <motion.div 
               initial={{ opacity: 0, y: 15 }} 
               animate={{ opacity: 1, y: 0 }} 
               className="flex flex-col items-center justify-center py-8 text-center"
             >
               <div className="w-20 h-20 rounded-full bg-primary/5 flex items-center justify-center mb-6 ring-[12px] ring-primary/5 relative">
                 <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping opacity-20" />
                 <DownloadCloud className="w-10 h-10 text-primary" />
               </div>
               <h3 className="text-xl font-bold text-foreground mb-3">{t("diarization.modelRequired")}</h3>
               <p className="text-base text-muted-foreground mb-8 max-w-[380px] leading-relaxed">
                 {t("diarization.modelRequiredDesc")}
               </p>
               <Button 
                onClick={handleGoToModels} 
                className="h-12 rounded-full px-8 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all font-semibold text-base"
               >
                 {t("diarization.goToModels")}
                 <ArrowRight className="w-5 h-5 ml-2" />
               </Button>
             </motion.div>
           ) : (
             <div className="space-y-6">
                {filesWithSettings.map((file, idx) => (
                  <motion.div 
                    key={file.id} 
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 + 0.1, duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                    className={cn(
                      "group rounded-2xl border transition-all duration-300 overflow-hidden",
                      file.enableDiarization 
                        ? "bg-card border-primary/30 shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)] shadow-primary/5" 
                        : "bg-muted/10 border-border/40 hover:border-border/60 hover:bg-muted/30"
                    )}
                  >
                    <div className="p-5 sm:p-6 flex items-center justify-between gap-4 cursor-pointer" onClick={() => handleToggleDiarization(file.id, !file.enableDiarization)}>
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center transition-colors duration-300",
                          file.enableDiarization ? "bg-primary text-primary-foreground shadow-inner shadow-primary-foreground/20" : "bg-muted text-muted-foreground"
                        )}>
                          <Users className="w-5 h-5" />
                        </div>
                        <div>
                           <h4 className={cn(
                             "text-[16px] font-semibold transition-colors duration-300",
                             file.enableDiarization ? "text-foreground" : "text-muted-foreground"
                           )}>
                             {t("diarization.enableDiarization")}
                           </h4>
                           <p className="text-[13.5px] text-muted-foreground mt-1">
                             {t("diarization.enableDiarizationDesc")}
                           </p>
                        </div>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch 
                          checked={file.enableDiarization}
                          onCheckedChange={(c) => handleToggleDiarization(file.id, c)}
                          className="data-[state=checked]:bg-primary"
                        />
                      </div>
                    </div>

                    <AnimatePresence>
                      {file.enableDiarization && (
                        <motion.div 
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="p-5 sm:p-6 pt-0 border-t border-border/20 mt-1">
                             <div className="pt-5 space-y-5">
                                <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-5 flex items-start gap-3.5 relative">
                                  <div className="absolute inset-0 bg-gradient-to-r from-blue-500/5 to-transparent pointer-events-none" />
                                  <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center shrink-0">
                                    <Info className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                  </div>
                                  <p className="text-[14.5px] leading-[1.6] text-blue-700/90 dark:text-blue-300 w-full min-w-0">
                                    {t("diarization.speakerCountHint").split(t("diarization.exactNumber")).map((part, i, arr) =>
                                      i < arr.length - 1 ? (
                                        <React.Fragment key={i}>{part}<strong className="font-semibold text-blue-800 dark:text-blue-200">{t("diarization.exactNumber")}</strong></React.Fragment>
                                      ) : part
                                    )}
                                  </p>
                                </div>
                                <label className="text-[14px] font-medium text-foreground mb-4 flex items-center justify-between">
                                  <span>{t("diarization.selectSpeakers")}</span>
                                </label>
                                <div className="flex flex-col sm:flex-row gap-3">
                                  <button
                                    onClick={() => handleSpeakerCountChange(file.id, "auto")}
                                    className={cn(
                                      "flex items-center justify-center gap-2 h-11 px-5 rounded-xl border font-semibold transition-all duration-200",
                                      file.numSpeakers === "auto" 
                                        ? "bg-primary/10 border-primary text-primary shadow-sm"
                                        : "bg-muted/20 border-border/60 hover:border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                    )}
                                  >
                                    <Sparkles className="w-4 h-4" />
                                    {t("diarization.autoDetect")}
                                  </button>
                                  <div className="flex-1 p-1 rounded-xl border border-border/50 bg-muted/20 flex overflow-hidden shadow-inner flex-wrap sm:flex-nowrap relative">
                                    {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                                      <button
                                        key={num}
                                        onClick={() => handleSpeakerCountChange(file.id, num as SpeakerCount)}
                                        className={cn(
                                          "flex-1 min-w-[32px] h-9 flex items-center justify-center text-[15px] font-semibold transition-all duration-200 rounded-lg",
                                          file.numSpeakers === num
                                            ? "bg-primary/10 ring-1 ring-primary text-primary shadow-sm" 
                                            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                                        )}
                                      >
                                        {num}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                             </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                ))}
             </div>
           )}
           </div>
        </div>

        {/* Footer */}
        <div className="px-6 sm:px-8 py-5 bg-muted/20 border-t border-border/40 flex flex-col sm:flex-row items-center justify-between gap-4">
            <label className="flex items-center gap-3 cursor-pointer group w-full sm:w-auto">
              <div className={cn(
                "w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center transition-all duration-200",
                rememberChoice
                  ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30"
                  : "bg-background/50 border-border/80 group-hover:border-border text-transparent"
              )}>
                <Check className="w-3.5 h-3.5" strokeWidth={3.5} />
              </div>
              <input type="checkbox" className="sr-only" checked={rememberChoice} onChange={e => setRememberChoice(e.target.checked)} />
              <span className="text-[14px] font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                {t("diarization.rememberChoice")}
              </span>
            </label>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Button variant="ghost" onClick={onClose} className="h-11 rounded-full px-6 hover:bg-muted/60 font-medium text-[14.5px] w-full sm:w-auto">
                {t("common.cancel")}
              </Button>
              <Button 
                onClick={handleConfirm} 
                className="h-11 rounded-full px-7 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all font-semibold text-[14.5px] w-full sm:w-auto"
              >
                {t("diarization.addToQueue")}
              </Button>
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
