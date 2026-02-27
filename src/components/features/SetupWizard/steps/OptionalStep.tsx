 

import { Button } from "@/components/ui/button";
import { useSetupStore } from "@/stores/setupStore";

/**
 * Step 4: Optional settings.
 */
export function OptionalStep() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Optional settings</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Configure non-required features.
        </p>
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <h4 className="text-sm font-medium mb-2">Note</h4>
        <p className="text-xs text-muted-foreground">
          This step is optional and can be configured later in settings.
        </p>
      </div>
    </div>
  );
}

export interface OptionalStepFooterProps {
  onBack: () => void;
  onNext: () => void;
  onGetToken?: () => string | undefined;
}

export function OptionalStepFooter({ onBack, onNext }: OptionalStepFooterProps) {
  const { runtimeReadiness, pythonCheck, ffmpegCheck } = useSetupStore();
  const canComplete =
    runtimeReadiness?.ready === true ||
    Boolean(
      pythonCheck?.status === "ok" &&
        ffmpegCheck?.installed &&
        ffmpegCheck.status !== "error"
    );

  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" onClick={onBack}>
        Back
      </Button>
      <div className="flex items-center gap-2">
        <Button onClick={onNext} disabled={!canComplete}>
          Continue
        </Button>
      </div>
    </div>
  );
}
