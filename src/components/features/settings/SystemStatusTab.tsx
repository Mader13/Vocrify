import { Film, Zap, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { useSetupStore } from "@/stores";
import { useI18n } from "@/hooks";
import { SystemStatusCard } from "./SystemStatusCard";
import type { StatusType } from "./SystemStatusCard";

function deriveStatus(check: { status: string } | null | undefined): StatusType {
  if (!check) return "pending";
  if (check.status === "ok") return "ok";
  if (check.status === "error") return "error";
  if (check.status === "warning") return "warning";
  return "pending";
}

interface SystemStatusTabProps {
  onRerunSetupClick: () => void;
}

export function SystemStatusTab({ onRerunSetupClick }: SystemStatusTabProps) {
  const { t } = useI18n();
  const { ffmpegCheck, deviceCheck, isChecking, checkAll } = useSetupStore();

  const ffmpegStatus = deriveStatus(ffmpegCheck);

  const availableDevices = deviceCheck?.devices?.filter((d) => d.available) ?? [];
  const deviceStatus: StatusType = !deviceCheck
    ? "pending"
    : deviceCheck.status === "error"
      ? "error"
      : deviceCheck.status === "warning"
        ? "warning"
        : availableDevices.length === 0
          ? "warning"
          : "ok";

  const ffmpegDetails = ffmpegCheck
    ? [ffmpegCheck.version ? `v${ffmpegCheck.version}` : "Not found", ffmpegCheck.path ?? "Path not defined"]
    : ["Checking..."];

  const deviceDetails = deviceCheck
    ? availableDevices.length === 0
      ? ["No acceleration available", "CPU will be used"]
      : [
          availableDevices.map((d) => (d.deviceType ?? "cpu").toUpperCase()).join(", "),
          deviceCheck.recommended ? `Recommended: ${deviceCheck.recommended.toUpperCase()}` : "",
        ].filter(Boolean)
    : ["Checking..."];

  return (
    <div className="space-y-8 h-full flex flex-col">
      <div>
        <h2 className="text-2xl font-semibold mb-1">{t("settings.systemTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.systemDescription")}</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <SystemStatusCard
          title={t("settings.ffmpegEngine")}
          icon={<Film className="h-4 w-4 text-purple-500" />}
          status={ffmpegStatus}
          details={ffmpegDetails}
          onRetry={checkAll}
          isLoading={isChecking}
        />
        <SystemStatusCard
          title={t("settings.computeDevices")}
          icon={<Zap className="h-4 w-4 text-blue-500" />}
          status={deviceStatus}
          details={deviceDetails}
          onRetry={checkAll}
          isLoading={isChecking}
        />
      </div>

      <div className="mt-4 p-5 rounded-[1.5rem] bg-gradient-to-br from-yellow-500/10 to-transparent border border-yellow-500/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] hover:border-yellow-500/30 transition-all group">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-yellow-500/20 shrink-0 group-hover:scale-105 transition-transform">
            <Sparkles className="h-5 w-5 text-yellow-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold mb-1 text-foreground/90">{t("settings.systemWizardTitle")}</h3>
            <p className="text-xs text-muted-foreground mb-4 max-w-sm">{t("settings.systemWizardDescription")}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRerunSetupClick}
              className="bg-yellow-500/10 hover:bg-yellow-500/30 text-yellow-600 dark:text-yellow-400 border-yellow-500/20"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t("settings.relaunchSetup")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
