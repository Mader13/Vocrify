import { RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui";

export type StatusType = "ok" | "error" | "warning" | "pending";

interface StatusConfig {
  bg: string;
  border: string;
  label: string;
  color: string;
  bgBadge: string;
  dot: string;
}

const STATUS_CONFIG: Record<StatusType, StatusConfig> = {
  ok: {
    bg: "bg-green-500/5",
    border: "border-green-500/20",
    label: "Ready",
    color: "text-green-600 dark:text-green-400",
    bgBadge: "bg-green-500/10",
    dot: "bg-green-500",
  },
  error: {
    bg: "bg-red-500/5",
    border: "border-red-500/20",
    label: "Error",
    color: "text-red-700 dark:text-red-400",
    bgBadge: "bg-red-500/10",
    dot: "bg-red-500",
  },
  warning: {
    bg: "bg-yellow-500/5",
    border: "border-yellow-500/20",
    label: "Warning",
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

const DETAIL_DOT_COLOR: Record<StatusType, string> = {
  ok: "bg-green-500/50",
  error: "bg-red-500/50",
  warning: "bg-yellow-500/50",
  pending: "bg-muted-foreground/30",
};

export interface SystemStatusCardProps {
  title: string;
  icon: React.ReactNode;
  status: StatusType;
  details: string[];
  onRetry?: () => void;
  isLoading?: boolean;
}

export function SystemStatusCard({ title, icon, status, details, onRetry, isLoading }: SystemStatusCardProps) {
  const config = STATUS_CONFIG[status];

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
      }}
      className={`${config.bg} ${config.border} border bg-card/40 backdrop-blur-md rounded-2xl p-4 transition-all hover:shadow-md hover:bg-card/60`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-2 rounded-lg ${config.bgBadge} ${config.color} shrink-0`}>{icon}</div>
          <span className="font-semibold text-sm truncate">{title}</span>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-medium ${config.bgBadge} ${config.color} shrink-0`}>
          <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
          <span>{config.label}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        {details.map((detail, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <div className={`w-1 h-1 rounded-full ${DETAIL_DOT_COLOR[status]}`} />
            <p className="text-xs text-muted-foreground truncate" title={detail}>
              {detail}
            </p>
          </div>
        ))}
      </div>

      {onRetry && status !== "ok" && (
        <Button variant="ghost" size="sm" onClick={onRetry} disabled={isLoading} className="mt-3 h-7 text-xs w-full">
          <RefreshCw className={`h-3 w-3 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
          Check
        </Button>
      )}
    </motion.div>
  );
}
