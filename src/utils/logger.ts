import { Config } from "../types/config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;
  private includeTimestamps: boolean;

  constructor(config: Config["logging"]) {
    this.level = config.level || "info";
    this.includeTimestamps = config.includeTimestamps ?? true;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[this.level];
  }

  private format(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const parts: string[] = [];

    if (this.includeTimestamps) {
      parts.push(new Date().toISOString());
    }

    parts.push(`[${level.toUpperCase()}]`);
    parts.push(message);

    if (meta && Object.keys(meta).length > 0) {
      parts.push(JSON.stringify(meta));
    }

    return parts.join(" ");
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      console.error(this.format("debug", message, meta));
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      console.error(this.format("info", message, meta));
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      console.error(this.format("warn", message, meta));
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog("error")) {
      console.error(this.format("error", message, meta));
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): Logger {
    const child = new Logger({ level: this.level, includeTimestamps: this.includeTimestamps });
    const originalFormat = child.format.bind(child);
    child.format = (level, message, meta) => {
      return originalFormat(level, message, { ...context, ...meta });
    };
    return child;
  }
}

/**
 * Global logger instance (initialized after config load)
 */
let globalLogger: Logger | null = null;

export function initLogger(config: Config["logging"]): Logger {
  globalLogger = new Logger(config);
  return globalLogger;
}

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger({ level: "info", includeTimestamps: true });
  }
  return globalLogger;
}