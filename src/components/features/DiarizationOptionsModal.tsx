import React, { useState, useEffect } from "react";
import { Check, Info } from "lucide-react";
import { DiarizationProvider, DIARIZATION_PROVIDERS } from "@/types";
import { formatFileSize, cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useUIStore } from "@/stores";

export type SpeakerCount = "auto" | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface FileWithSettings {
  id: string;
  name: string;
  path: string;
  size: number;
  enableDiarization: boolean;
  diarizationProvider: DiarizationProvider | null;
  numSpeakers: SpeakerCount;
}

export interface DiarizationOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (filesWithSettings: FileWithSettings[], rememberChoice: boolean) => void;
  files: Array<{ path: string; name: string; size: number }>;
  availableDiarizationProviders: DiarizationProvider[];
  lastUsedProvider: DiarizationProvider;
}

export const DiarizationOptionsModal: React.FC<DiarizationOptionsModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  files,
  availableDiarizationProviders,
  lastUsedProvider,
}) => {
  const { setCurrentView } = useUIStore();
  const [filesWithSettings, setFilesWithSettings] = useState<FileWithSettings[]>([]);
  const [rememberChoice, setRememberChoice] = useState(false);

  // Initialize files with settings when modal opens
  useEffect(() => {
    if (isOpen && files.length > 0) {
      const autoProvider = availableDiarizationProviders.length === 1
        ? availableDiarizationProviders[0]
        : lastUsedProvider;

      setFilesWithSettings(
        files.map((file) => ({
          id: `${file.path}-${Date.now()}-${Math.random()}`,
          name: file.name,
          path: file.path,
          size: file.size,
          enableDiarization: availableDiarizationProviders.length > 0,
          diarizationProvider: availableDiarizationProviders.length > 0 ? autoProvider : null,
          numSpeakers: 'auto' as SpeakerCount,
        }))
      );
    }
  }, [isOpen, files, availableDiarizationProviders, lastUsedProvider]);

  const handleToggleDiarization = (fileId: string, enabled: boolean) => {
    setFilesWithSettings((prev) =>
      prev.map((file) =>
        file.id === fileId
          ? {
              ...file,
              enableDiarization: enabled,
              diarizationProvider: enabled
                ? file.diarizationProvider || (availableDiarizationProviders.length === 1 ? availableDiarizationProviders[0] : lastUsedProvider)
                : null,
            }
          : file
      )
    );
  };

  const handleProviderChange = (fileId: string, provider: DiarizationProvider) => {
    setFilesWithSettings((prev) =>
      prev.map((file) =>
        file.id === fileId ? { ...file, diarizationProvider: provider } : file
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

  const handleConfirm = () => {
    onConfirm(filesWithSettings, rememberChoice);
    onClose();
  };

  const hasProviders = availableDiarizationProviders.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden shadow-2xl">
        {/* Header */}
        <DialogHeader className="px-7 pt-6 pb-5 border-b border-border/40">
          <DialogTitle className="text-lg font-semibold text-foreground">
            Настройки транскрибации
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-7 py-5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border/20 hover:scrollbar-thumb-border/40">
          {/* Files List */}
          <div className="space-y-3">
            {filesWithSettings.map((file) => (
              <Card
                key={file.id}
                className={cn(
                  "group relative overflow-hidden border-border/60 transition-all duration-200",
                  file.enableDiarization
                    ? "bg-card shadow-sm hover:shadow-md hover:border-border"
                    : "bg-muted/30 border-border/30"
                )}
              >
                <div className="p-4">
                  {/* File Header */}
                  <div className="flex items-start justify-between gap-4">
                    {/* File Info */}
                    <div className="flex-1 min-w-0 pr-4">
                      <p className={cn(
                        "font-medium truncate transition-colors",
                        file.enableDiarization
                          ? "text-foreground"
                          : "text-muted-foreground"
                      )}>
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground/80 mt-1">
                        {formatFileSize(file.size)}
                      </p>
                    </div>

                    {/* Toggle */}
                    <div className="flex items-center gap-3 shrink-0">
                      <Switch
                        checked={file.enableDiarization}
                        onCheckedChange={(checked) =>
                          handleToggleDiarization(file.id, checked)
                        }
                        disabled={!hasProviders}
                      />
                      <span className={cn(
                        "text-sm font-medium transition-colors whitespace-nowrap",
                        !hasProviders
                          ? "text-muted-foreground"
                          : file.enableDiarization
                            ? "text-foreground"
                            : "text-muted-foreground"
                      )}>
                        Диаризация
                      </span>
                    </div>
                  </div>

                  {/* Diarization Settings */}
                  {file.enableDiarization && hasProviders && (
                    <div className="mt-4 pt-4 border-t border-border/40">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Provider Selection */}
                        <div className="space-y-2">
                          <label className="text-[15px] font-medium text-foreground/90 flex items-center gap-1.5">
                            Провайдер
                          </label>
                          <div className="relative">
                            <select
                              value={file.diarizationProvider || ''}
                              onChange={(e) => {
                                const provider = e.target.value as DiarizationProvider;
                                handleProviderChange(file.id, provider);
                              }}
                              disabled={availableDiarizationProviders.length === 1}
                              className={cn(
                                "w-full h-10 px-3.5 rounded-lg border bg-background text-sm transition-all duration-200",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50",
                                "hover:border-border/80",
                                availableDiarizationProviders.length === 1
                                  ? "cursor-not-allowed bg-muted/30 opacity-60"
                                  : "cursor-pointer border-border/60"
                              )}
                            >
                              {availableDiarizationProviders.map((provider) => (
                                <option key={provider} value={provider}>
                                  {DIARIZATION_PROVIDERS[provider].name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Speaker Count Selection */}
                        <div className="space-y-2">
                          <label className="text-[15px] font-medium text-foreground/90 flex items-center gap-1.5">
                            Количество спикеров
                          </label>
                          <select
                            value={file.numSpeakers}
                            onChange={(e) =>
                              handleSpeakerCountChange(
                                file.id,
                                e.target.value as SpeakerCount
                              )
                            }
                            className="w-full h-10 px-3.5 rounded-lg border border-border/60 bg-background text-sm transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50 hover:border-border/80 appearance-none pr-10"
                            style={{
                              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
                              backgroundRepeat: 'no-repeat',
                              backgroundPosition: 'right 0.75rem center',
                              backgroundSize: '1rem'
                            }}
                          >
                            <option value="auto">Авто</option>
                            {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                              <option key={num} value={num}>
                                {num} {num === 1 ? 'спикер' : num > 1 && num < 5 ? 'спикера' : 'спикеров'}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {/* No Providers Warning */}
          {!hasProviders && (
            <Card className="mt-4 p-5 bg-amber-50/80 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-800/40">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center shrink-0">
                  <Info className="w-4 h-4 text-amber-600 dark:text-amber-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-amber-900 dark:text-amber-100 font-medium">
                    Модель диаризации не установлена
                  </p>
                  <p className="text-sm text-amber-700/80 dark:text-amber-200/70 mt-1">
                    Для использования функции разделения по спикерам необходимо установить модель диаризации.
                  </p>
                  <button
                    onClick={() => {
                      setCurrentView("models");
                      onClose();
                    }}
                    className="mt-2.5 text-sm text-amber-700 dark:text-amber-300 font-medium hover:text-amber-900 dark:hover:text-amber-100 transition-colors underline underline-offset-2"
                  >
                    Перейти к управлению моделями →
                  </button>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Info Note */}
        {hasProviders && (
          <div className="px-7 pb-4">
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-muted/40 border border-border/40">
              <Info className="w-4 h-4 text-primary/70 shrink-0 mt-0.5" />
              <p className="text-[15px] text-muted-foreground leading-relaxed">
                Для качественного разделения по спикерам настоятельно рекомендуется указывать точное количество спикеров
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <DialogFooter className="px-7 py-4 border-t border-border/40 bg-muted/20 flex items-center justify-between">
          <label className="flex items-center gap-2.5 cursor-pointer group hover:opacity-80 transition-opacity">
            <input
              type="checkbox"
              checked={rememberChoice}
              onChange={(e) => setRememberChoice(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20 focus:ring-offset-0 transition-all cursor-pointer"
            />
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              Запомнить выбор
            </span>
          </label>

          <div className="flex gap-2.5">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-9 px-4 border-border/60 hover:border-border hover:bg-muted/40 transition-all duration-200"
            >
              Отмена
            </Button>
            <Button
              onClick={handleConfirm}
              className="h-9 px-4 bg-primary hover:bg-primary/90 transition-all duration-200 shadow-sm hover:shadow"
            >
              <Check className="w-4 h-4 mr-1.5" />
              Добавить в очередь
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
