import { useState, useEffect } from "react";

import {
  Clock,
  Cpu,
  Download,
  FileText,
  Mic2,
} from "lucide-react";

import { StageBadges } from "@/components/features/StageBadges";
import { ProgressMetricsDisplay } from "@/components/features/ProgressMetrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressEnhanced } from "@/components/ui/progress-enhanced";
import { formatTime } from "@/lib/utils";
import { MODEL_CONFIGS } from "@/types";
import type { TranscriptionTask } from "@/types";

interface ProcessingViewProps {
  task: TranscriptionTask;
}

const stageConfig = {
  ready: { icon: Clock, label: "Подготовка", color: "text-muted-foreground" },
  loading: { icon: Cpu, label: "Загрузка модели", color: "text-blue-500" },
  downloading: { icon: Download, label: "Скачивание модели", color: "text-blue-500" },
  transcribing: { icon: Mic2, label: "Распознавание речи", color: "text-primary" },
  diarizing: { icon: FileText, label: "Диаризация", color: "text-purple-500" },
  finalizing: { icon: FileText, label: "Финализация", color: "text-green-500" },
};

export function ProcessingView({ task }: ProcessingViewProps) {
  const stage = task.stage || "transcribing";
  const normalizedStage = stage === "downloading" ? "loading" : stage;
  const config = stageConfig[normalizedStage as keyof typeof stageConfig] || stageConfig.transcribing;
  const Icon = config.icon;
  const segments = task.result?.segments || [];
  const segmentCount = segments.length;
  const streamingSegments = task.streamingSegments || [];
  const modelConfig = MODEL_CONFIGS[task.options.model];
  const isSlowModel = modelConfig.speedCategory === "slow";

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!task.startedAt) {
      setElapsedSeconds(0);
      return;
    }

    const calculateElapsed = () => {
      const start = new Date(task.startedAt!).getTime();
      const now = Date.now();
      return Math.floor((now - start) / 1000);
    };

    setElapsedSeconds(calculateElapsed());

    const interval = setInterval(() => {
      setElapsedSeconds(calculateElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [task.startedAt, task.status]);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-lg">
            {task.fileName}
          </CardTitle>
        </div>
        <div className="mt-3">
          <StageBadges
            currentStage={normalizedStage}
            enableDiarization={task.options.enableDiarization}
          />
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
        <div className="relative">
          <div className="w-24 h-24 rounded-full border-4 border-muted" />
          <div
            className="absolute inset-0 w-24 h-24 rounded-full border-4 border-primary border-t-transparent"
            style={{
              animation: "spin 1.5s linear infinite",
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon className={`h-8 w-8 ${config.color}`} />
          </div>
        </div>

        <div className="w-full max-w-md space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className={`flex items-center gap-2 font-medium ${config.color}`}>
              <Icon className="h-4 w-4" />
              {config.label}
            </span>
            <span className="text-muted-foreground font-mono">{task.progress}%</span>
          </div>

          <ProgressEnhanced value={task.progress} stage={normalizedStage} className="h-3" />

          <div className="flex items-center justify-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-muted-foreground">
              {formatTime(elapsedSeconds)}
            </span>
          </div>

          {task.metrics && <ProgressMetricsDisplay metrics={task.metrics} />}

          <p className="text-center text-sm text-muted-foreground">
            Пожалуйста, подождите. Это может занять несколько минут в зависимости от длительности файла.
          </p>

          {segmentCount > 0 && (
            <div className="text-center">
              <span className="text-sm font-medium text-primary">
                {segmentCount} {segmentCount === 1 ? 'segment' : 'segments'} transcribed
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/50 px-4 py-2 rounded-lg">
          <span>Модель: {task.options.model}</span>
          <span className="w-px h-3 bg-border" />
          <span>Устройство: {task.options.device === "cuda" ? "GPU" : "CPU"}</span>
          <span className="w-px h-3 bg-border" />
          <span>Язык: {task.options.language}</span>
        </div>

        {streamingSegments.length > 0 && isSlowModel && (
          <div className="w-full max-w-md max-h-40 overflow-y-auto bg-muted/30 rounded-lg p-3 space-y-2">
            {streamingSegments.slice(-5).map((segment, idx) => (
              <div
                key={idx}
                className="text-xs border-b border-muted/50 last:border-0 pb-1 last:pb-0"
              >
                <span className="font-mono text-muted-foreground">
                  {formatTime(segment.start)}
                </span>
                <span className="ml-2">{segment.text}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
