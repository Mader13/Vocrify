/* eslint-disable no-console, @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */

import { MAX_JSON_SIZE_BYTES } from "./utils";

/**
 * Logger utility for transcription and upload processes
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

function shouldPersistLogs(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return !("__TAURI__" in window);
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  category: "transcription" | "upload" | "model" | "system";
  message: string;
  data?: any;
  taskId?: string;
  fileName?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsole: boolean;
  enableStorage: boolean;
  maxStorageEntries: number;
}

export function formatPerformanceMetrics(metrics?: {
  modelLoadMs?: number;
  decodeMs?: number;
  inferenceMs?: number;
  diarizationMs?: number;
  totalMs?: number;
}): string {
  if (!metrics) {
    return "";
  }

  const entries = [
    metrics.modelLoadMs !== undefined ? `modelLoad=${metrics.modelLoadMs}ms` : null,
    metrics.decodeMs !== undefined ? `decode=${metrics.decodeMs}ms` : null,
    metrics.inferenceMs !== undefined ? `inference=${metrics.inferenceMs}ms` : null,
    metrics.diarizationMs !== undefined ? `diarization=${metrics.diarizationMs}ms` : null,
    metrics.totalMs !== undefined ? `total=${metrics.totalMs}ms` : null,
  ].filter((value): value is string => value !== null);

  return entries.join(" ");
}

class Logger {
  private config: LoggerConfig;
  private logs: LogEntry[] = [];
  private listeners: Set<(logs: LogEntry[]) => void> = new Set();

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = {
      level: LogLevel.INFO,
      enableConsole: true,
      enableStorage: shouldPersistLogs(),
      maxStorageEntries: 1000,
      ...config,
    };

    // Load persisted logs from localStorage
    this.loadPersistedLogs();
  }

  private loadPersistedLogs(): void {
    if (!this.config.enableStorage) return;

    try {
      const stored = localStorage.getItem("vocrify-logs");
      if (stored) {
        // Basic size check for HIGH-10
        if (stored.length > MAX_JSON_SIZE_BYTES) {
          console.warn("Log data too large, clearing");
          localStorage.removeItem("vocrify-logs");
          return;
        }
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.logs = parsed.map((log: any) => ({
            ...log,
            timestamp: new Date(log.timestamp),
          }));
        }
      }
    } catch (error) {
      console.warn("Failed to load persisted logs:", error);
      this.logs = [];
    }
  }

  private persistLogs(): void {
    if (!this.config.enableStorage) return;

    try {
      const toStore = this.logs.slice(-this.config.maxStorageEntries);
      localStorage.setItem("vocrify-logs", JSON.stringify(toStore));
    } catch (error) {
      console.warn("Failed to persist logs:", error);
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.logs));
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level;
  }

  private addLog(entry: Omit<LogEntry, "id" | "timestamp">): void {
    if (!this.shouldLog(entry.level)) return;

    const logEntry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      ...entry,
    };

    this.logs.push(logEntry);

    // Trim logs if exceeding max storage
    if (this.logs.length > this.config.maxStorageEntries) {
      this.logs = this.logs.slice(-this.config.maxStorageEntries);
    }

    // Console output
    if (this.config.enableConsole) {
      const prefix = `[${entry.category.toUpperCase()}${entry.taskId ? `:${entry.taskId}` : ""}]`;
      
      switch (entry.level) {
        case LogLevel.DEBUG:
          console.debug(`%c${prefix}`, this.getConsoleStyle(entry.level), entry.message, entry.data || "");
          break;
        case LogLevel.INFO:
          console.info(`%c${prefix}`, this.getConsoleStyle(entry.level), entry.message, entry.data || "");
          break;
        case LogLevel.WARN:
          console.warn(`%c${prefix}`, this.getConsoleStyle(entry.level), entry.message, entry.data || "");
          break;
        case LogLevel.ERROR:
          console.error(`%c${prefix}`, this.getConsoleStyle(entry.level), entry.message, entry.data || "");
          break;
      }
    }

    // Persist and notify
    this.persistLogs();
    this.notifyListeners();
  }

  private getConsoleStyle(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return "color: #6b7280; font-weight: normal;";
      case LogLevel.INFO:
        return "color: #3b82f6; font-weight: normal;";
      case LogLevel.WARN:
        return "color: #f59e0b; font-weight: bold;";
      case LogLevel.ERROR:
        return "color: #ef4444; font-weight: bold;";
      default:
        return "";
    }
  }

  // Category-specific logging methods
  debug(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.DEBUG,
      category: "system",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  info(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.INFO,
      category: "system",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  warn(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.WARN,
      category: "system",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  error(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.ERROR,
      category: "system",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  // Transcription-specific methods
  transcriptionDebug(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.DEBUG,
      category: "transcription",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  transcriptionInfo(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.INFO,
      category: "transcription",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  transcriptionWarn(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.WARN,
      category: "transcription",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  transcriptionError(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.ERROR,
      category: "transcription",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  // Upload-specific methods
  uploadDebug(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.DEBUG,
      category: "upload",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  uploadInfo(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.INFO,
      category: "upload",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  uploadWarn(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.WARN,
      category: "upload",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  uploadError(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.ERROR,
      category: "upload",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  // Model-specific methods
  modelDebug(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.DEBUG,
      category: "model",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  modelInfo(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.INFO,
      category: "model",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  modelWarn(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.WARN,
      category: "model",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  modelError(message: string, data?: any, options?: { taskId?: string; fileName?: string }): void {
    this.addLog({
      level: LogLevel.ERROR,
      category: "model",
      message,
      data,
      taskId: options?.taskId,
      fileName: options?.fileName,
    });
  }

  // Utility methods
  getLogs(filter?: {
    level?: LogLevel;
    category?: LogEntry["category"];
    taskId?: string;
    fileName?: string;
    limit?: number;
  }): LogEntry[] {
    let filtered = [...this.logs];

    if (filter) {
      if (filter.level !== undefined) {
        filtered = filtered.filter(log => log.level >= filter.level!);
      }
      if (filter.category) {
        filtered = filtered.filter(log => log.category === filter.category);
      }
      if (filter.taskId) {
        filtered = filtered.filter(log => log.taskId === filter.taskId);
      }
      if (filter.fileName) {
        filtered = filtered.filter(log => log.fileName === filter.fileName);
      }
      if (filter.limit) {
        filtered = filtered.slice(-filter.limit);
      }
    }

    return filtered.reverse(); // Most recent first
  }

  clearLogs(): void {
    this.logs = [];
    this.persistLogs();
    this.notifyListeners();
  }

  subscribe(listener: (logs: LogEntry[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updateConfig(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.enableStorage !== undefined || config.maxStorageEntries !== undefined) {
      this.persistLogs();
    }
  }

  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  getLogStats(): {
    total: number;
    byLevel: Record<LogLevel, number>;
    byCategory: Record<string, number>;
  } {
    const byLevel = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 0,
      [LogLevel.WARN]: 0,
      [LogLevel.ERROR]: 0,
    };

    const byCategory: Record<string, number> = {};

    this.logs.forEach(log => {
      byLevel[log.level]++;
      byCategory[log.category] = (byCategory[log.category] || 0) + 1;
    });

    return {
      total: this.logs.length,
      byLevel,
      byCategory,
    };
  }
}

// Singleton instance
export const logger = new Logger();

