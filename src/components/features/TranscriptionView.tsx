import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTasks, useUIStore } from "@/stores";

import { CompletedView } from "./CompletedView";
import { ProcessingView } from "./ProcessingView";
import { QueuedView } from "./QueuedView";

export function TranscriptionView() {
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const task = useTasks((s) => s.tasks.find((t) => t.id === selectedTaskId));
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (task?.status === "completed" && task.result) {
      const timer = setTimeout(() => {
        setShowCompleted(true);
      }, 800);
      return () => clearTimeout(timer);
    } else {
      setShowCompleted(false);
    }
  }, [task?.status, task?.result]);

  if (!selectedTaskId || !task) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="rounded-full bg-muted p-4 mb-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold mb-2">Нет выбранной задачи</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Выберите задачу из списка слева, чтобы просмотреть результат транскрипции.
          Загрузите видео или аудио файл для создания новой задачи.
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
        <CardContent>
          <p className="text-destructive">Error: {task.error}</p>
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
        <h2 className="text-lg font-semibold mb-2">Транскрипция отменена</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Задача была отменена пользователем. Вы можете удалить её из списка
          или загрузить файл заново для повторной обработки.
        </p>
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
    <AnimatePresence mode="wait">
      {!showCompleted ? (
        <motion.div
          key="processing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.3 }}
          className="h-full"
        >
          <ProcessingView task={task} />
        </motion.div>
      ) : (
        <motion.div
          key="completed"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="h-full"
        >
          <CompletedView task={task} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
