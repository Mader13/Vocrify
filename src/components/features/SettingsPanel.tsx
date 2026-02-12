import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, RotateCcw, AlertTriangle } from "lucide-react";
import {
  Button,
  Select,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui";
import { useUIStore, useTasks, useSetupStore } from "@/stores";
import { selectOutputDirectory, clearCache } from "@/services/tauri";
import { LANGUAGE_NAMES } from "@/types";
import type { Language } from "@/types";

export function SettingsPanel() {
  const isSettingsOpen = useUIStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

  const settings = useTasks((s) => s.settings);
  const updateSettings = useTasks((s) => s.updateSettings);
  const resetSettings = useTasks((s) => s.resetSettings);

  const resetSetupState = useSetupStore((s) => s.resetSetupState);

  const panelRef = useRef<HTMLDivElement>(null);
  const [isRerunSetupDialogOpen, setIsRerunSetupDialogOpen] = useState(false);

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    },
    [setSettingsOpen]
  );

  useEffect(() => {
    if (isSettingsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isSettingsOpen, handleClickOutside]);

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ defaultLanguage: e.target.value as Language });
  };

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ defaultDevice: e.target.value as "cpu" | "cuda" });
  };

  const handleMaxConcurrentChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateSettings({ maxConcurrentTasks: parseInt(e.target.value, 10) });
  };

  const handleSelectOutputDirectory = async () => {
    const result = await selectOutputDirectory();
    if (result.success && result.data) {
      updateSettings({ outputDirectory: result.data });
    }
  };

  const handleReset = () => {
    resetSettings();
  };

  const handleClearCache = async () => {
    const result = await clearCache();
    if (result.success) {
      // Reload the page to apply changes
      window.location.reload();
    } else {
      console.error("Failed to clear cache:", result.error);
    }
  };

  const handleRerunSetup = async () => {
    await resetSetupState();
    setIsRerunSetupDialogOpen(false);
    setSettingsOpen(false);
    // Перезагружаем приложение для показа SetupWizard
    window.location.reload();
  };

  return (
    <Dialog open={isSettingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent ref={panelRef} size="lg">
        <DialogHeader>
          <DialogTitle>Настройки</DialogTitle>
          <DialogDescription>
            Настройте параметры транскрипции
          </DialogDescription>
        </DialogHeader>

        <DialogClose onClick={() => setSettingsOpen(false)} />

        <div className="space-y-6 py-4">
          {/* Device Section */}
          <div className="space-y-2">
            <label htmlFor="device" className="text-sm font-medium">
              Устройство обработки
            </label>
            <Select
              id="device"
              value={settings.defaultDevice}
              onChange={handleDeviceChange}
            >
              <option value="cpu">CPU (процессор)</option>
              <option value="cuda">CUDA (графический процессор)</option>
            </Select>
            <p className="text-xs text-muted-foreground">
              Выберите между процессором и видеокартой
            </p>
          </div>

          {/* Language Section */}
          <div className="space-y-2">
            <label htmlFor="language" className="text-sm font-medium">
              Язык по умолчанию
            </label>
            <Select
              id="language"
              value={settings.defaultLanguage}
              onChange={handleLanguageChange}
            >
              {Object.entries(LANGUAGE_NAMES).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Язык по умолчанию для транскрипции
            </p>
          </div>

          {/* Max Concurrent Tasks */}
          <div className="space-y-2">
            <label htmlFor="max-concurrent" className="text-sm font-medium">
              Максимальное количество задач
            </label>
            <Select
              id="max-concurrent"
              value={settings.maxConcurrentTasks.toString()}
              onChange={handleMaxConcurrentChange}
            >
              {[1, 2, 3, 4].map((num) => (
                <option key={num} value={num}>
                  {num}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Максимальное число одновременных транскрипций
            </p>
          </div>

          {/* Output Directory */}
          <div className="space-y-2">
            <label htmlFor="output-dir" className="text-sm font-medium">
              Папка для сохранения
            </label>
            <div className="flex gap-2">
              <input
                id="output-dir"
                type="text"
                readOnly
                value={settings.outputDirectory || "По умолчанию (там же, где исходный файл)"}
                className="flex-1 px-3 py-2 text-sm border rounded-md bg-muted"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectOutputDirectory}
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                Обзор
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Где сохранять файлы транскрипций
            </p>
          </div>

          {/* Setup Wizard Section */}
          <div className="pt-4 mt-4 border-t">
            <h3 className="text-sm font-medium mb-2">Первичная настройка</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Запустить мастер первоначальной настройки для проверки системы
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsRerunSetupDialogOpen(true)}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Запустить мастер настройки
            </Button>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="destructive" onClick={handleClearCache}>
            Очистить кэш
          </Button>
          <Button variant="outline" onClick={handleReset}>
            Сбросить настройки
          </Button>
          <Button onClick={() => setSettingsOpen(false)}>Готово</Button>
        </DialogFooter>
      </DialogContent>

      {/* Rerun Setup Confirmation Dialog */}
      <Dialog open={isRerunSetupDialogOpen} onOpenChange={setIsRerunSetupDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-full bg-yellow-500/10 p-2">
                <AlertTriangle className="h-5 w-5 text-yellow-500" />
              </div>
              <DialogTitle>Запустить мастер настройки?</DialogTitle>
            </div>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Мастер первоначальной настройки будет запущен при следующем запуске приложения. 
              Это позволит заново проверить состояние системы и настроить компоненты.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRerunSetupDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleRerunSetup}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Запустить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
