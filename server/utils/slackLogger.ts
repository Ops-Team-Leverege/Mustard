import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

const LOG_DIR = path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LOG_LEVEL = (process.env.LOG_LEVEL as LogLevel) || 'info';

interface LogMeta {
  correlationId?: string;
  channel?: string;
  threadTs?: string;
  userId?: string;
  intent?: string;
  contract?: string;
  duration?: number;
  error?: string;
  stack?: string;
  [key: string]: any;
}

export function generateCorrelationId(): string {
  return uuidv4().substring(0, 8);
}

export function logToFile(level: LogLevel, message: string, meta?: LogMeta): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[CURRENT_LOG_LEVEL]) return;
  
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  
  const dateStr = new Date().toISOString().split('T')[0];
  const logFile = path.join(LOG_DIR, `slack-${dateStr}.log`);
  
  try {
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    console.error('[SlackLogger] Failed to write to log file:', err);
  }
  
  const correlationPrefix = meta?.correlationId ? `[${meta.correlationId}] ` : '';
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${level.toUpperCase()}] ${correlationPrefix}${message}${metaStr}`);
}

export function logInfo(message: string, meta?: LogMeta): void {
  logToFile('info', message, meta);
}

export function logError(message: string, meta?: LogMeta): void {
  logToFile('error', message, meta);
}

export function logWarn(message: string, meta?: LogMeta): void {
  logToFile('warn', message, meta);
}

export function logDebug(message: string, meta?: LogMeta): void {
  logToFile('debug', message, meta);
}

export class RequestLogger {
  private correlationId: string;
  private startTime: number;
  private channel?: string;
  private threadTs?: string;
  private userId?: string;
  private stages: Map<string, number> = new Map();

  constructor(channel?: string, threadTs?: string, userId?: string) {
    this.correlationId = generateCorrelationId();
    this.startTime = Date.now();
    this.channel = channel;
    this.threadTs = threadTs;
    this.userId = userId;
  }

  private getMeta(extra?: Partial<LogMeta>): LogMeta {
    return {
      correlationId: this.correlationId,
      channel: this.channel,
      threadTs: this.threadTs,
      userId: this.userId,
      duration: Date.now() - this.startTime,
      ...extra
    };
  }

  startStage(name: string): void {
    this.stages.set(name, Date.now());
  }

  endStage(name: string): number {
    const start = this.stages.get(name);
    if (!start) return 0;
    const duration = Date.now() - start;
    this.stages.delete(name);
    return duration;
  }

  info(message: string, extra?: Partial<LogMeta>): void {
    logInfo(message, this.getMeta(extra));
  }

  error(message: string, err?: Error | unknown, extra?: Partial<LogMeta>): void {
    const errorMeta: Partial<LogMeta> = {};
    if (err instanceof Error) {
      errorMeta.error = err.message;
      errorMeta.stack = err.stack;
    } else if (err) {
      errorMeta.error = String(err);
    }
    logError(message, this.getMeta({ ...errorMeta, ...extra }));
  }

  warn(message: string, extra?: Partial<LogMeta>): void {
    logWarn(message, this.getMeta(extra));
  }

  debug(message: string, extra?: Partial<LogMeta>): void {
    logDebug(message, this.getMeta(extra));
  }

  getCorrelationId(): string {
    return this.correlationId;
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }
}
