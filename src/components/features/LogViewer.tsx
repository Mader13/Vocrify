import { useEffect, useState } from "react";
import { Filter, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { logger, type LogEntry, LogLevel } from "@/lib/logger";

interface LogViewerProps {
  className?: string;
}

function parseLogLevel(value: string): LogLevel | "all" {
  if (value === "all") {
    return "all";
  }

  const parsed = Number(value);
  if (
    parsed === LogLevel.DEBUG ||
    parsed === LogLevel.INFO ||
    parsed === LogLevel.WARN ||
    parsed === LogLevel.ERROR
  ) {
    return parsed;
  }

  return "all";
}

function parseLogCategory(value: string): LogEntry["category"] | "all" {
  if (value === "all" || value === "transcription" || value === "upload" || value === "model" || value === "system") {
    return value;
  }

  return "all";
}

export function LogViewer({ className }: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<{
    level: LogLevel | "all";
    category: LogEntry["category"] | "all";
  }>({ level: "all", category: "all" });

  useEffect(() => {
    const unsubscribe = logger.subscribe((newLogs) => {
      setLogs(newLogs);
    });

    return () => unsubscribe();
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (filter.level !== "all" && log.level !== filter.level) {
      return false;
    }
    if (filter.category !== "all" && log.category !== filter.category) {
      return false;
    }
    return true;
  });

  const getLevelIcon = (level: LogLevel) => {
    switch (level) {
      case LogLevel.DEBUG:
        return "🔍";
      case LogLevel.INFO:
        return "ℹ️";
      case LogLevel.WARN:
        return "⚠️";
      case LogLevel.ERROR:
        return "❌";
    }
  };

  const getCategoryColor = (category: LogEntry["category"]) => {
    switch (category) {
      case "transcription":
        return "text-blue-600";
      case "upload":
        return "text-green-600";
      case "model":
        return "text-purple-600";
      case "system":
        return "text-gray-600";
    }
  };

  const exportLogs = () => {
    const data = logger.exportLogs();
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocrify-logs-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const clearLogs = () => {
    logger.clearLogs();
  };

  return (
    <div className={cn("flex flex-col h-full bg-gray-900 text-gray-100", className)}>
      <div className="border-b border-gray-700 p-4 bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">System Logs</h2>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={exportLogs}
              className="text-gray-300 hover:text-white"
            >
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearLogs}
              className="text-gray-300 hover:text-red-400"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Clear
            </Button>
          </div>
        </div>

        <div className="flex gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={filter.level}
              onChange={(e) => setFilter({ ...filter, level: parseLogLevel(e.target.value) })}
              className="bg-gray-700 border-gray-600 text-gray-100 rounded px-3 py-1 text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Levels</option>
              <option value={LogLevel.DEBUG.toString()}>Debug</option>
              <option value={LogLevel.INFO.toString()}>Info</option>
              <option value={LogLevel.WARN.toString()}>Warning</option>
              <option value={LogLevel.ERROR.toString()}>Error</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={filter.category}
              onChange={(e) => setFilter({ ...filter, category: parseLogCategory(e.target.value) })}
              className="bg-gray-700 border-gray-600 text-gray-100 rounded px-3 py-1 text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Categories</option>
              <option value="transcription">Transcription</option>
              <option value="upload">Upload</option>
              <option value="model">Model</option>
              <option value="system">System</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-1">
        {filteredLogs.length === 0 ? (
          <div className="text-center text-gray-500 py-8">No logs to display</div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className={cn(
                "flex gap-3 p-2 rounded hover:bg-gray-800 transition-colors",
                log.level === LogLevel.ERROR && "bg-red-900/20",
                log.level === LogLevel.WARN && "bg-yellow-900/20"
              )}
            >
              <div className="text-lg shrink-0">
                {getLevelIcon(log.level)}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("text-xs font-medium", getCategoryColor(log.category))}>
                    {log.category.toUpperCase()}
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  {log.taskId && (
                    <span className="text-xs text-blue-400">
                      Task: {log.taskId.slice(0, 8)}...
                    </span>
                  )}
                </div>
                <div className="text-gray-300 break-words">
                  {log.message}
                </div>
                {log.data && (
                  <details className="mt-1">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                      View Details
                    </summary>
                    <pre className="mt-2 text-xs bg-gray-800 p-2 rounded overflow-x-auto">
                      {JSON.stringify(log.data, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
