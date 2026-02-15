import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSetupStore } from "@/stores/setupStore";
import { useTasks } from "@/stores";

function statusIcon(state: string) {
  if (state === "completed") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (state === "skipped") return <CircleDashed className="h-4 w-4 text-yellow-500" />;
  if (state === "error" || state === "timed_out") return <XCircle className="h-4 w-4 text-red-500" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

function statusLabel(state: string) {
  if (state === "completed") return "Готово";
  if (state === "skipped") return "Пропущено";
  if (state === "error") return "Ошибка";
  if (state === "timed_out") return "Таймаут";
  if (state === "running") return "Выполняется";
  return "Ожидание";
}

export function SummaryStep() {
  const { pythonCheck, ffmpegCheck, deviceCheck, modelCheck, goToStep } = useSetupStore();
  const huggingFaceToken = useTasks((s) => s.settings.huggingFaceToken);

  const handleInstallPythonNow = async () => {
    goToStep("python");
  };

  // Map check results to status strings
  const getStepStatus = (check: { status: string } | null): string => {
    if (!check) return "idle";
    if (check.status === "ok" || check.status === "completed") return "completed";
    if (check.status === "error") return "error";
    if (check.status === "running") return "running";
    return "idle";
  };

  const pythonStatus = pythonCheck ? getStepStatus(pythonCheck) : "idle";
  const ffmpegStatus = ffmpegCheck ? getStepStatus(ffmpegCheck) : "idle";
  const deviceStatus = deviceCheck ? getStepStatus(deviceCheck) : "idle";
  const modelStatus = modelCheck ? getStepStatus(modelCheck) : "idle";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Итог настройки</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Проверка статусов обязательных и опциональных компонентов
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        {([
          ["Python", pythonStatus],
          ["FFmpeg", ffmpegStatus],
          [
            "Devices",
            deviceStatus,
            deviceCheck?.recommended
              ? `Рекомендуется: ${deviceCheck.recommended.toUpperCase()}`
              : "Fallback: CPU",
          ],
          ["Models", modelStatus],
          ["HuggingFace token", huggingFaceToken ? "completed" : "skipped", huggingFaceToken ? "Установлен" : "Отсутствует"],
        ] as const).map(([name, state, hint]) => (
          <div key={name} className="flex items-center justify-between border-b last:border-b-0 py-2">
            <div className="flex items-center gap-2">
              {statusIcon(state)}
              <div>
                <span className="font-medium">{name}</span>
                {hint && (
                  <p className="text-xs text-muted-foreground">{hint}</p>
                )}
              </div>
            </div>
            <span className="text-sm text-muted-foreground">{statusLabel(state)}</span>
          </div>
        ))}
      </div>

      {pythonStatus === "idle" && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600" />
            <div>
              <p className="text-sm font-medium">Python не проверен</p>
              <p className="text-xs text-muted-foreground mt-1">
                Нажмите "Далее" для запуска проверки.
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={handleInstallPythonNow}>
                Проверить
              </Button>
            </div>
          </div>
        </div>
      )}

      {pythonCheck?.status === "error" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-400">
          <div className="space-y-2">
            <p>{pythonCheck.message}</p>
            <Button size="sm" variant="outline" onClick={handleInstallPythonNow}>
              Попробовать снова
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface SummaryStepFooterProps {
  onBack: () => void;
  onComplete: () => void;
}

export function SummaryStepFooter({ onBack, onComplete }: SummaryStepFooterProps) {
  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" onClick={onBack}>
        Назад
      </Button>
      <Button onClick={onComplete}>Завершить настройку</Button>
    </div>
  );
}
