import { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  RotateCcw,
  AlertTriangle,
  Cpu,
  Film,
  FileCode,
  Settings2,
  Languages,
  Layers,
  HardDrive,
  Sparkles,
  RefreshCw,
  Zap,
} from "lucide-react";
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
import { useSetupStore as useSetupStoreCheck } from "@/stores/setupStore";
import { selectOutputDirectory, clearCache } from "@/services/tauri";
import { DEVICE_NAMES, LANGUAGE_NAMES } from "@/types";
import type { DeviceType, Language } from "@/types";

interface SystemStatusCardProps {
  title: string;
  icon: React.ReactNode;
  status: "ok" | "error" | "warning" | "pending";
  details: string[];
  onRetry?: () => void;
  isLoading?: boolean;
}

function SystemStatusCard({ title, icon, status, details, onRetry, isLoading }: SystemStatusCardProps) {
  const statusConfig = {
    ok: {
      bg: "bg-green-500/5",
      border: "border-green-500/20",
      label: "Готово",
      color: "text-green-600 dark:text-green-400",
      bgBadge: "bg-green-500/10",
      dot: "bg-green-500",
    },
    error: {
      bg: "bg-red-500/5",
      border: "border-red-500/20",
      label: "Ошибка",
      color: "text-red-600 dark:text-red-400",
      bgBadge: "bg-red-500/10",
      dot: "bg-red-500",
    },
    warning: {
      bg: "bg-yellow-500/5",
      border: "border-yellow-500/20",
      label: "Внимание",
      color: "text-yellow-600 dark:text-yellow-400",
      bgBadge: "bg-yellow-500/10",
      dot: "bg-yellow-500",
    },
    pending: {
      bg: "bg-muted/30",
      border: "border-muted",
      label: "...",
      color: "text-muted-foreground",
      bgBadge: "bg-muted",
      dot: "bg-muted-foreground",
    },
  };

  const config = statusConfig[status];

  return (
    <div className={`${config.bg} ${config.border} border rounded-xl p-4 transition-all hover:shadow-sm`}>
      {/* Header: Title + Status Badge */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-2 rounded-lg ${config.bgBadge} ${config.color} shrink-0`}>
            {icon}
          </div>
          <span className="font-semibold text-sm truncate">{title}</span>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium ${config.bgBadge} ${config.color} shrink-0`}>
          <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
          <span>{config.label}</span>
        </div>
      </div>

      {/* Details with better text handling */}
      <div className="space-y-1.5">
        {details.map((detail, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <div className={`w-1 h-1 rounded-full ${status === "ok" ? "bg-green-500/50" : status === "error" ? "bg-red-500/50" : "bg-muted-foreground/30"}`} />
            <p className="text-xs text-muted-foreground truncate" title={detail}>
              {detail}
            </p>
          </div>
        ))}
      </div>

      {onRetry && status !== "ok" && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          disabled={isLoading}
          className="mt-3 h-7 text-xs w-full"
        >
          <RefreshCw className={`h-3 w-3 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Проверить
        </Button>
      )}
    </div>
  );
}

export function SettingsPanel() {
  const isSettingsOpen = useUIStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

  const settings = useTasks((s) => s.settings);
  const updateSettings = useTasks((s) => s.updateSettings);
  const resetSettings = useTasks((s) => s.resetSettings);

  const resetSetupState = useSetupStore((s) => s.resetSetupState);
  
  const setupStore = useSetupStoreCheck();
  const { ffmpegCheck, pythonCheck, deviceCheck, isChecking, checkAll } = setupStore;

  const panelRef = useRef<HTMLDivElement>(null);
  const [isRerunSetupDialogOpen, setIsRerunSetupDialogOpen] = useState(false);

  useEffect(() => {
    if (isSettingsOpen && !ffmpegCheck) {
      checkAll();
    }
  }, [isSettingsOpen]);

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      // Don't close settings if confirmation dialog is open
      if (isRerunSetupDialogOpen) return;
      
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    },
    [setSettingsOpen, isRerunSetupDialogOpen]
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
    updateSettings({ defaultDevice: e.target.value as DeviceType });
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

  const handleClearOutputDirectory = () => {
    updateSettings({ outputDirectory: "" });
  };

  const handleReset = () => {
    resetSettings();
  };

  const handleClearCache = async () => {
    const result = await clearCache();
    if (result.success) {
      window.location.reload();
    } else {
      console.error("Failed to clear cache:", result.error);
    }
  };

  const handleRerunSetup = async () => {
    await resetSetupState();
    setIsRerunSetupDialogOpen(false);
    setSettingsOpen(false);
    window.location.reload();
  };

  const handleRetryCheck = () => {
    checkAll();
  };

  const ffmpegStatus = ffmpegCheck?.status === "ok" ? "ok" : ffmpegCheck?.status === "error" ? "error" : ffmpegCheck?.status === "warning" ? "warning" : "pending";
  const pythonStatus = pythonCheck?.status === "ok" ? "ok" : pythonCheck?.status === "error" ? "error" : pythonCheck?.status === "warning" ? "warning" : "pending";
  
  const availableDevices = deviceCheck?.devices?.filter(d => d.available) || [];
  const availableDevicesCount = availableDevices.length;
  
  const deviceStatus = !deviceCheck 
    ? "pending" 
    : deviceCheck.status === "error" 
      ? "error" 
      : deviceCheck.status === "warning"
        ? "warning"
        : availableDevicesCount === 0
          ? "warning"
          : "ok";

  const ffmpegDetails = ffmpegCheck 
    ? [
        ffmpegCheck.version ? `v${ffmpegCheck.version}` : "Не найден",
        ffmpegCheck.path || "Путь не определен",
      ]
    : ["Проверка..."];

  const pythonDetails = pythonCheck
    ? [
        pythonCheck.version ? `Python ${pythonCheck.version}` : "Не найден",
        pythonCheck.pytorchInstalled 
          ? `PyTorch ${pythonCheck.pytorchVersion || ""} ${pythonCheck.cudaAvailable ? "(CUDA)" : pythonCheck.mpsAvailable ? "(MPS)" : ""}`.trim()
          : "PyTorch не установлен",
      ]
    : ["Проверка..."];

  const deviceDetails = deviceCheck
    ? availableDevicesCount === 0
      ? ["Ускорение недоступно", "Будет использован CPU"]
      : [
          availableDevices.map(d => (d.deviceType || "cpu").toUpperCase()).join(", ") || "CPU",
          deviceCheck.recommended ? `Рекомендуется: ${deviceCheck.recommended.toUpperCase()}` : "",
        ].filter(Boolean)
    : ["Проверка..."];

  const getOutputPathDisplay = () => {
    if (!settings.outputDirectory) {
      return "Рядом с исходным файлом";
    }
    return settings.outputDirectory;
  };

  return (
    <>
      <Dialog open={isSettingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent ref={panelRef} className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Settings2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Настройки</DialogTitle>
              <DialogDescription>
                Управление параметрами и состоянием системы
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogClose onClick={() => setSettingsOpen(false)} />

        <div className="space-y-6 py-4">
          {/* System Status Section - Prominent Status Cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Состояние системы
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRetryCheck}
                disabled={isChecking}
                className="h-7 text-xs"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${isChecking ? "animate-spin" : ""}`} />
                Обновить
              </Button>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <SystemStatusCard
                title="FFmpeg"
                icon={<Film className="h-4 w-4 text-purple-500" />}
                status={ffmpegStatus}
                details={ffmpegDetails}
                onRetry={handleRetryCheck}
                isLoading={isChecking}
              />
              <SystemStatusCard
                title="Python"
                icon={<FileCode className="h-4 w-4 text-yellow-500" />}
                status={pythonStatus}
                details={pythonDetails}
                onRetry={handleRetryCheck}
                isLoading={isChecking}
              />
              <SystemStatusCard
                title="Устройства"
                icon={<Zap className="h-4 w-4 text-blue-500" />}
                status={deviceStatus}
                details={deviceDetails}
                onRetry={handleRetryCheck}
                isLoading={isChecking}
              />
            </div>
          </div>

          {/* Settings Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 pt-2 border-t">
              <Settings2 className="h-4 w-4" />
              Параметры транскрипции
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Device Section */}
              <div className="space-y-2">
                <label htmlFor="device" className="text-sm font-medium flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-muted-foreground" />
                  Устройство
                </label>
                <Select
                  id="device"
                  value={settings.defaultDevice}
                  onChange={handleDeviceChange}
                >
                  {Object.entries(DEVICE_NAMES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Language Section */}
              <div className="space-y-2">
                <label htmlFor="language" className="text-sm font-medium flex items-center gap-2">
                  <Languages className="h-4 w-4 text-muted-foreground" />
                  Язык
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
              </div>
            </div>

            {/* Max Concurrent Tasks */}
            <div className="space-y-2">
              <label htmlFor="max-concurrent" className="text-sm font-medium flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                Одновременные задачи
              </label>
              <Select
                id="max-concurrent"
                value={settings.maxConcurrentTasks.toString()}
                onChange={handleMaxConcurrentChange}
                className="w-32"
              >
                {[1, 2, 3, 4].map((num) => (
                  <option key={num} value={num}>
                    {num}
                  </option>
                ))}
              </Select>
            </div>

            {/* Output Directory - Enhanced */}
            <div className="space-y-3 pt-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                Папка для сохранения
              </label>
              
              <div className={`rounded-lg border-2 p-4 transition-all ${
                settings.outputDirectory 
                  ? "border-primary/30 bg-primary/5" 
                  : "border-dashed border-muted-foreground/30 bg-muted/30"
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${settings.outputDirectory ? "text-foreground" : "text-muted-foreground"}`}>
                      {getOutputPathDisplay()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {settings.outputDirectory 
                        ? "Все транскрипции будут сохранены в эту папку"
                        : "По умолчанию файлы сохраняются рядом с исходным видео"}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {settings.outputDirectory && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearOutputDirectory}
                        className="h-8 text-xs"
                      >
                        По умолчанию
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSelectOutputDirectory}
                      className="h-8"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Setup Wizard Section */}
          <div className="pt-4 mt-2 border-t">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-yellow-500/10">
                <Sparkles className="h-4 w-4 text-yellow-500" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium mb-1">Первичная настройка</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Запустите мастер настройки для проверки и настройки системы
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsRerunSetupDialogOpen(true)}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Запустить мастер
                </Button>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2 flex-wrap">
          <Button variant="destructive" onClick={handleClearCache} size="sm">
            Очистить кэш
          </Button>
          <Button variant="outline" onClick={handleReset} size="sm">
            Сбросить
          </Button>
          <Button onClick={() => setSettingsOpen(false)} size="sm">
            Готово
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Rerun Setup Confirmation Dialog - rendered as overlay */}
    {isRerunSetupDialogOpen && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setIsRerunSetupDialogOpen(false)}
        />
        <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-md p-6 z-10">
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
            <Button
              variant="outline"
              onClick={() => setIsRerunSetupDialogOpen(false)}
            >
              Отмена
            </Button>
            <Button onClick={handleRerunSetup}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Запустить
            </Button>
          </DialogFooter>
        </div>
      </div>
    )}
    </>
  );
}
