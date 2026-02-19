import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, FileText, RefreshCw, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTasks, useUIStore } from "@/stores";
import { usePlaybackStore } from "@/stores/playbackStore";

import { CompletedView } from "./CompletedView";
import { ProcessingView } from "./ProcessingView";
import { QueuedView } from "./QueuedView";

export function TranscriptionView() {
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const retryTask = useTasks((s) => s.retryTask);
  const tasks = useTasks((s) => s.tasks);

  const task = tasks.find((t) => t.id === selectedTaskId);

  const playingTaskId = usePlaybackStore((s) => s.playingTaskId);
  const isPlayingTaskVisible = playingTaskId === selectedTaskId;

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
        <h2 className="text-lg font-semibold mb-2">No Task Selected</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Select a task from the list on the left to view the transcription result.
          Upload a video or audio file to create a new task.
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
          <p className="text-destructive">Error: {task.error}</p>
          <Button onClick={() => retryTask(task.id)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
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
        <h2 className="text-lg font-semibold mb-2">Transcription Cancelled</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          The task was cancelled by the user. You can remove it from the list
          or re-upload the file for reprocessing.
        </p>
        <Button onClick={() => retryTask(task.id)} className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
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
        <h2 className="text-lg font-semibold mb-2">Transcription Interrupted</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          The application closed during processing. You can remove this task or
          re-upload the file to restart transcription.
        </p>
        <Button onClick={() => retryTask(task.id)} className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  if (!task.result) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-full items-center justify-center p-6">
          <p className="text-muted-foreground">No transcription data</p>
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
