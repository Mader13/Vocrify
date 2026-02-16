import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTasks, useUIStore } from "@/stores";

import { CompletedView } from "./CompletedView";
import { ProcessingView } from "./ProcessingView";
import { QueuedView } from "./QueuedView";

export function TranscriptionView() {
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const task = useTasks((s) => s.tasks.find((t) => t.id === selectedTaskId));

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
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-lg">{task.fileName}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Task was cancelled
          </p>
        </CardContent>
      </Card>
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

  return <CompletedView task={task} />;
}
