/* eslint-disable react-refresh/only-export-components */

import { useState } from "react";
import { Key, ExternalLink, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSetupStore } from "@/stores/setupStore";

/**
 * Step 4: Optional settings.
 */
export function OptionalStep() {
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState("");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Optional settings</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Configure non-required features.
        </p>
      </div>

      <div className="rounded-lg border border-muted bg-muted/30 p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 p-2 rounded-lg bg-primary/10 text-primary">
            <Key className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium">HuggingFace Token</h4>
            <p className="text-sm text-muted-foreground mt-0.5">
              Optional token for high-quality diarization providers.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="hf-token" className="text-sm font-medium">
            API Token
          </label>
          <div className="relative">
            <input
              id="hf-token"
              type={showToken ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxx"
              className={cn(
                "w-full rounded-md border border-input bg-background px-3 py-2 pr-10",
                "text-sm placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
              autoComplete="off"
              spellCheck="false"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              aria-label={showToken ? "Hide token" : "Show token"}
            >
              {showToken ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Get token at{" "}
            <a
              href="https://huggingface.co/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              huggingface.co/settings/tokens
              <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </div>

        {token && (
          <div className="flex items-center gap-2 text-sm">
            {token.startsWith("hf_") ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />
                <span className="text-green-600 dark:text-green-400">
                  Token format looks valid
                </span>
              </>
            ) : (
              <span className="text-yellow-600 dark:text-yellow-400">
                Token should start with `hf_`
              </span>
            )}
          </div>
        )}
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

export function useOptionalStep() {
  const [huggingFaceToken, setHuggingFaceToken] = useState<string | null>(null);

  const saveToken = (token: string) => {
    setHuggingFaceToken(token || null);
  };

  const clearToken = () => {
    setHuggingFaceToken(null);
  };

  return {
    huggingFaceToken,
    saveToken,
    clearToken,
  };
}
