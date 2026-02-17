import { Hourglass } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TranscriptionTask } from "@/types";

interface QueuedViewProps {
  task: TranscriptionTask;
}

export function QueuedView({ task }: QueuedViewProps) {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="border-b">
        <CardTitle className="text-lg flex items-center gap-2">
          <Hourglass className="h-5 w-5 text-muted-foreground" />
          {task.fileName}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
        <div className="relative">
          <div className="w-20 h-20 rounded-full border-4 border-muted flex items-center justify-center">
            <Hourglass className="h-8 w-8 text-muted-foreground animate-pulse" />
          </div>
        </div>

        <div className="w-full max-w-md space-y-4 text-center">
          <h3 className="text-lg font-medium">In Queue</h3>
          <p className="text-sm text-muted-foreground">
            The task is waiting to be processed. It will start automatically when resources become available.
          </p>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span>Waiting...</span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/50 px-4 py-2 rounded-lg">
          <span>Model: {task.options.model}</span>
          <span className="w-px h-3 bg-border" />
          <span>Device: {task.options.device === "cuda" ? "GPU" : "CPU"}</span>
          <span className="w-px h-3 bg-border" />
          <span>Language: {task.options.language}</span>
        </div>
      </CardContent>
    </Card>
  );
}
