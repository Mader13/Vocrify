import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui";
import { useI18n } from "@/hooks";

interface RerunSetupDialogProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RerunSetupDialog({ isOpen, onCancel, onConfirm }: RerunSetupDialogProps) {
  const { t } = useI18n();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-md p-6 z-10">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-yellow-500/10 p-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
            </div>
            <DialogTitle>{t("settings.rerunSetupTitle")}</DialogTitle>
          </div>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-muted-foreground">
            {t("settings.rerunSetupDescription")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onConfirm}>
            <RotateCcw className="h-4 w-4 mr-2" />
            {t("settings.rerunSetupConfirm")}
          </Button>
        </DialogFooter>
      </div>
    </div>
  );
}
