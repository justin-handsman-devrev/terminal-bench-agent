import winston from 'winston';
import path from 'path';
import fs from 'fs';

export function setupFileLogging(logLevel: string = 'INFO', logDir?: string): string {
  const actualLogDir = logDir || 'logs';
  
  if (!fs.existsSync(actualLogDir)) {
    fs.mkdirSync(actualLogDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const logFile = path.join(actualLogDir, `orchestrator_${timestamp}.log`);

  const logger = winston.createLogger({
    level: logLevel.toLowerCase(),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      new winston.transports.File({
        filename: logFile,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            return `${timestamp} - ${level.toUpperCase()} - ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
          })
        ),
      }),
      new winston.transports.Console({
        level: 'info',
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} - ${level} - ${message}`;
          })
        ),
      }),
    ],
  });

  winston.configure({
    level: logLevel.toLowerCase(),
    transports: logger.transports,
    format: logger.format,
  });

  return logFile;
}

export class TurnLogger {
  private enabled: boolean;
  private logDir?: string;
  private prefix: string;

  constructor(logDir?: string, prefix: string = 'agent') {
    this.logDir = logDir;
    this.prefix = prefix;
    this.enabled = !!logDir;

    if (this.enabled && logDir && !fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  async logTurn(turnNum: number, data: Record<string, any>): Promise<string | null> {
    if (!this.enabled || !this.logDir) {
      return null;
    }

    const sanitizedData = this.sanitizeForJson(data);
    sanitizedData.turnNumber = turnNum;
    sanitizedData.timestamp = new Date().toISOString();
    sanitizedData.prefix = this.prefix;

    const fileName = `${this.prefix}_turn_${turnNum.toString().padStart(3, '0')}.json`;
    const filePath = path.join(this.logDir, fileName);

    try {
      await fs.promises.writeFile(filePath, JSON.stringify(sanitizedData, null, 2), 'utf-8');
      winston.debug(`Logged turn ${turnNum} to ${filePath}`);
      return filePath;
    } catch (error) {
      winston.error(`Failed to log turn ${turnNum}: ${error}`);
      return null;
    }
  }

  async logFinalSummary(data: Record<string, any>, filename: string = 'summary.json'): Promise<string | null> {
    if (!this.enabled || !this.logDir) {
      return null;
    }

    const sanitizedData = this.sanitizeForJson(data);
    sanitizedData.timestamp = new Date().toISOString();
    sanitizedData.prefix = this.prefix;

    const filePath = path.join(this.logDir, `${this.prefix}_${filename}`);

    try {
      await fs.promises.writeFile(filePath, JSON.stringify(sanitizedData, null, 2), 'utf-8');
      winston.info(`Logged summary to ${filePath}`);
      return filePath;
    } catch (error) {
      winston.error(`Failed to log summary: ${error}`);
      return null;
    }
  }

  private sanitizeForJson(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeForJson(item));
    }

    if (typeof data === 'object') {
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        sanitized[key] = this.sanitizeForJson(value);
      }
      return sanitized;
    }

    return String(data);
  }
}
