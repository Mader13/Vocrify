import { cn } from "@/lib/utils";
import { MODEL_NAMES, DIARIZATION_PROVIDERS } from "@/types";

interface ModelDisplayCardProps {
  icon: string;
  title: string;
  value: string | null;
  description?: string;
  size?: "default" | "large";
  gradient?: "purple" | "blue" | "emerald" | "rose";
  switchControl?: React.ReactNode;
}

const gradients = {
  purple: "from-purple-500/20 via-purple-500/5 to-transparent",
  blue: "from-blue-500/20 via-blue-500/5 to-transparent",
  emerald: "from-emerald-500/20 via-emerald-500/5 to-transparent",
  rose: "from-rose-500/20 via-rose-500/5 to-transparent",
};

const borderColors = {
  purple: "border-purple-500/30 hover:border-purple-500/60",
  blue: "border-blue-500/30 hover:border-blue-500/60",
  emerald: "border-emerald-500/30 hover:border-emerald-500/60",
  rose: "border-rose-500/30 hover:border-rose-500/60",
};

const glowColors = {
  purple: "hover:shadow-purple-500/20",
  blue: "hover:shadow-blue-500/20",
  emerald: "hover:shadow-emerald-500/20",
  rose: "hover:shadow-rose-500/20",
};

export function ModelDisplayCard({
  icon,
  title,
  value,
  description,
  size = "default",
  gradient = "blue",
  switchControl,
}: ModelDisplayCardProps) {
  const isEmpty = !value || value === "Не выбрана" || value === "Не выбран" || value === "Disabled" || value.toLowerCase().includes("no speaker");

  return (
    <div
      className={cn(
        "relative group overflow-hidden rounded-2xl border bg-card/50 backdrop-blur-sm transition-all duration-500 ease-out",
        !isEmpty && borderColors[gradient],
        "hover:-translate-y-1 hover:shadow-2xl",
        !isEmpty && glowColors[gradient],
        size === "large" ? "p-6" : "p-5"
      )}
    >
      <div
        className={cn(
          "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500",
          gradients[gradient]
        )}
      />

      <div className="relative flex items-start gap-4">
        <div
          className={cn(
            "relative flex-shrink-0 flex items-center justify-center rounded-xl transition-all duration-500",
            isEmpty
              ? "bg-muted/30 text-muted-foreground"
              : `bg-gradient-to-br from-${gradient === 'rose' ? 'rose' : gradient === 'emerald' ? 'emerald' : gradient === 'purple' ? 'purple' : 'blue'}-500/10 to-${gradient === 'rose' ? 'rose' : gradient === 'emerald' ? 'emerald' : gradient === 'purple' ? 'purple' : 'blue'}-500/5 text-foreground shadow-lg`,
            "group-hover:scale-105",
            size === "large" ? "w-14 h-14 text-3xl" : "w-12 h-12 text-2xl"
          )}
        >
          {icon}
          {!isEmpty && (
            <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-white/20 to-transparent" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            {!isEmpty && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
          </div>

          <p
            className={cn(
              "font-semibold transition-all duration-300",
              size === "large" ? "text-lg" : "text-base",
              isEmpty ? "text-muted-foreground/50" : "text-foreground",
              !isEmpty && "group-hover:text-transparent group-hover:bg-gradient-to-r group-hover:from-foreground group-hover:to-foreground/70 group-hover:bg-clip-text"
            )}
          >
            {value || "Не выбрана"}
          </p>

          {description && !isEmpty && (
            <p className="text-xs text-muted-foreground mt-1 transition-opacity duration-300">
              {description}
            </p>
          )}
        </div>

        {switchControl && (
          <div className="flex-shrink-0 flex items-center self-center">
            {switchControl}
          </div>
        )}
      </div>

      {!isEmpty && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-current to-transparent opacity-0 group-hover:opacity-30 transition-opacity duration-500" />
      )}
    </div>
  );
}

export function TranscriptionModelDisplay({
  model,
  size = "default",
}: {
  model: string | null;
  size?: "default" | "large";
}) {
  const modelName = model ? MODEL_NAMES[model as keyof typeof MODEL_NAMES] || model : null;
  const sizeText = model?.includes("tiny") ? "40MB" : model?.includes("base") ? "80MB" : model?.includes("small") ? "250MB" : model?.includes("medium") ? "760MB" : model?.includes("large") ? "1.5GB" : model?.includes("parakeet") ? "640MB+" : "";

  return (
    <ModelDisplayCard
      icon="🐍"
      title="Модель транскрипции"
      value={modelName}
      description={sizeText}
      size={size}
      gradient={model?.includes("tiny") ? "emerald" : model?.includes("base") ? "blue" : model?.includes("small") ? "purple" : model?.includes("medium") ? "rose" : "purple"}
    />
  );
}

export function DiarizationModelDisplay({
  provider,
  size = "default",
}: {
  provider: string | null;
  size?: "default" | "large";
}) {
  const providerInfo = provider ? DIARIZATION_PROVIDERS[provider as keyof typeof DIARIZATION_PROVIDERS] : null;
  const providerName = providerInfo?.name || null;

  return (
    <ModelDisplayCard
      icon="🎤"
      title="Модель диаризации"
      value={providerName}
      description={providerInfo?.description}
      size={size}
      gradient={provider === "pyannote" ? "purple" : provider === "sherpa-onnx" ? "emerald" : "blue"}
    />
  );
}
