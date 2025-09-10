import chalk from 'chalk';
import { Logger, Config } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export class ConsoleLogger implements Logger {
  private config: Config;
  private logFile?: string;

  constructor(config: Config) {
    this.config = config;
    if (config.logging.logToFile) {
      this.logFile = path.join(process.cwd(), 'devrev-coder.log');
    }
  }

  private writeToFile(level: string, message: string, ...args: any[]): void {
    if (!this.logFile) return;

    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message} ${args.length > 0 ? JSON.stringify(args) : ''}\n`;
    
    fs.appendFileSync(this.logFile, logLine);
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.config.logging.level);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  debug(message: string, ...args: any[]): void {
    if (!this.shouldLog('debug')) return;
    
    console.log(chalk.gray(`🔍 [DEBUG] ${message}`), ...args);
    this.writeToFile('debug', message, ...args);
  }

  info(message: string, ...args: any[]): void {
    if (!this.shouldLog('info')) return;
    
    console.log(chalk.blue(`ℹ️  [INFO] ${message}`), ...args);
    this.writeToFile('info', message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    if (!this.shouldLog('warn')) return;
    
    console.log(chalk.yellow(`⚠️  [WARN] ${message}`), ...args);
    this.writeToFile('warn', message, ...args);
  }

  error(message: string, ...args: any[]): void {
    if (!this.shouldLog('error')) return;
    
    console.error(chalk.red(`❌ [ERROR] ${message}`), ...args);
    this.writeToFile('error', message, ...args);
  }

  success(message: string, ...args: any[]): void {
    console.log(chalk.green(`✅ ${message}`), ...args);
    this.writeToFile('info', `SUCCESS: ${message}`, ...args);
  }

  highlight(message: string, ...args: any[]): void {
    console.log(chalk.cyan.bold(`🌟 ${message}`), ...args);
    this.writeToFile('info', `HIGHLIGHT: ${message}`, ...args);
  }

  separator(): void {
    console.log(chalk.gray('─'.repeat(60)));
  }

  table(data: Record<string, any>[]): void {
    if (data.length === 0) return;
    
    const headers = Object.keys(data[0]);
    const colWidths = headers.map(header => 
      Math.max(header.length, ...data.map(row => String(row[header] || '').length))
    );

    // Header
    const headerRow = headers.map((header, i) => 
      header.padEnd(colWidths[i])
    ).join(' | ');
    console.log(chalk.bold(headerRow));
    console.log(chalk.gray('─'.repeat(headerRow.length)));

    // Data rows
    data.forEach(row => {
      const dataRow = headers.map((header, i) => 
        String(row[header] || '').padEnd(colWidths[i])
      ).join(' | ');
      console.log(dataRow);
    });
  }
}
