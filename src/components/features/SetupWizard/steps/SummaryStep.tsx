import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSetupStore } from "@/stores/setupStore";
import { useI18n } from "@/hooks";

function statusIcon(state: string) {
  if (state === "completed") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (state === "skipped") return <CircleDashed className="h-4 w-4 text-yellow-500" />;
  if (state === "error" || state === "timed_out") return <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

export function SummaryStep() {
  const { t } = useI18n();
  const { pythonCheck, ffmpegCheck, deviceCheck, goToStep } = useSetupStore();

  const handleInstallPythonNow = async () => {
    goToStep("python");
  };

  const statusLabel = (state: string) => {
    if (state === "completed") return t("setup.statusCompleted");
    if (state === "skipped") return t("setup.statusSkipped");
    if (state === "error") return t("setup.statusError");
    if (state === "timed_out") return t("setup.statusTimedOut");
    if (state === "running") return t("setup.statusRunning");
    return t("setup.statusPending");
  }

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
  const modelStatus = useSetupStore.getState().modelCheck ? getStepStatus(useSetupStore.getState().modelCheck) : "idle";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t("setup.summaryTitle")}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {t("setup.summaryDesc")}
        </p>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
        <h4 className="text-sm font-medium">{t("setup.whatNext")}</h4>
        <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
           <li>{t("setup.afterDownload")}</li>
        </ol>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        {([
          [t("setup.python"), pythonStatus],
          [t("setup.ffmpeg"), ffmpegStatus],
          [t("setup.devices"), deviceStatus, deviceCheck?.recommended ? `${t("setup.recommended")}: ${deviceCheck.recommended.toUpperCase()}` : t("setup.recommendedFallback")],
          [t("setup.modelsStep"), modelStatus],
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
              <p className="text-sm font-medium">{t("setup.pythonNotChecked")}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("setup.clickNextToCheck")}
              </p>
              <Button size="sm" variant="outline" className="mt-3" onClick={handleInstallPythonNow}>
                {t("setup.check")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pythonCheck?.status === "error" && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-400">
          <div className="space-y-2">
            <p>{pythonCheck.message}</p>
            <Button size="sm" variant="outline" onClick={handleInstallPythonNow}>
              {t("setup.tryAgain")}
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
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" onClick={onBack}>
        {t("setup.back")}
      </Button>
      <div className="flex items-center gap-2">
        <Button onClick={onComplete}>{t("setup.finishSetup")}</Button>
      </div>
    </div>
  );
}

