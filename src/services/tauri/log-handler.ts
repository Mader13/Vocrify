import { logger } from "@/lib/logger";

export interface LogEvent {
  level: string;
  category: string;
  message: string;
  data?: unknown;
  taskId?: string;
  fileName?: string;
}

type LogCategory = "transcription" | "upload" | "model" | "system";

const LEVEL_MAP: Record<string, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
};

interface LogMethod {
  (message: string, data?: unknown, context?: Record<string, unknown>): void;
}

const TRANSCRIPTION_METHODS: Record<number, LogMethod> = {
  0: logger.transcriptionDebug,
  1: logger.transcriptionInfo,
  2: logger.transcriptionWarn,
  3: logger.transcriptionError,
};

const UPLOAD_METHODS: Record<number, LogMethod> = {
  0: logger.uploadDebug,
  1: logger.uploadInfo,
  2: logger.uploadWarn,
  3: logger.uploadError,
};

const MODEL_METHODS: Record<number, LogMethod> = {
  0: logger.modelDebug,
  1: logger.modelInfo,
  2: logger.modelWarn,
  3: logger.modelError,
};

const SYSTEM_METHODS: Record<number, LogMethod> = {
  0: logger.debug,
  1: logger.info,
  2: logger.warn,
  3: logger.error,
};

const CATEGORY_METHODS: Record<LogCategory, Record<number, LogMethod>> = {
  transcription: TRANSCRIPTION_METHODS,
  upload: UPLOAD_METHODS,
  model: MODEL_METHODS,
  system: SYSTEM_METHODS,
};

export function handleBackendLog(logEvent: LogEvent): void {
  const level = LEVEL_MAP[logEvent.level] ?? 3;
  const category = logEvent.category as LogCategory;
  const context = {
    taskId: logEvent.taskId,
    fileName: logEvent.fileName,
  };

  const methods = CATEGORY_METHODS[category] ?? SYSTEM_METHODS;
  const logMethod = methods[level] ?? logger.error;
  logMethod(logEvent.message, logEvent.data, context);
}
