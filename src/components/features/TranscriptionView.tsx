import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, FileText, RefreshCw, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks";
import { useTasks, useUIStore } from "@/stores";

import { CompletedView } from "./CompletedView";
import { ProcessingView } from "./ProcessingView";
import { QueuedView } from "./QueuedView";

export function TranscriptionView() {
  const { t } = useI18n();
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const retryTask = useTasks((s) => s.retryTask);
  const tasks = useTasks((s) => s.tasks);

  const task = tasks.find((t) => t.id === selectedTaskId);

  // Derived state - no useEffect needed
  const showCompleted = useMemo(
    () => task?.status === "completed" && !!task?.result,
    [task?.status, task?.result]
  );

  if (!selectedTaskId || !task) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="rounded-full bg-muted p-4 mb-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold mb-2">{t("transcriptionView.noTaskTitle")}</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t("transcriptionView.noTaskDesc")}
        </p>
      </div>
    );
  }

  if (task.status === "queued") {
    return <QueuedView task={task} />;
  }

  if (task.status === "processing") {
    return <ProcessingView task={task} />;
  }

  if (task.status === "failed") {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg">{task.fileName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-destructive">{`${t("transcriptionView.error")}: ${task.error}`}</p>
          <Button onClick={() => retryTask(task.id)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("common.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (task.status === "cancelled") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="rounded-full bg-destructive/10 p-4 mb-4">
          <XCircle className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-lg font-semibold mb-2">{t("transcriptionView.cancelled")}</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t("transcriptionView.cancelledDesc")}
        </p>
        <Button onClick={() => retryTask(task.id)} className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (task.status === "interrupted") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="rounded-full bg-orange-500/10 p-4 mb-4">
          <AlertTriangle className="h-8 w-8 text-orange-500" />
        </div>
        <h2 className="text-lg font-semibold mb-2">{t("transcriptionView.interrupted")}</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t("transcriptionView.interruptedDesc")}
        </p>
        <Button onClick={() => retryTask(task.id)} className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  if (!task.result) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full items-center justify-center p-6">
          <p className="text-muted-foreground">{t("transcriptionView.noData")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!showCompleted ? (
        <motion.div
          key="processing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="h-full will-change-transform"
        >
          <ProcessingView task={task} />
        </motion.div>
      ) : (
        <motion.div
          key="completed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="h-full will-change-transform"
        >
          <CompletedView task={task} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
