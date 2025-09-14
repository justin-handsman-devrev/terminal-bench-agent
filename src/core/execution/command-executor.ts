import { spawn } from 'child_process';
import { ExecutionResult } from '../../types';

export abstract class CommandExecutor {
  constructor(protected workingDir?: string) {}
  abstract execute(cmd: string, timeout?: number): Promise<ExecutionResult>;
  abstract executeBackground(cmd: string): Promise<void>;
}

export class LocalExecutor extends CommandExecutor {
  async execute(cmd: string, timeout: number = 120): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const wrapped = this.workingDir ? `cd '${this.workingDir}' && ${cmd}` : cmd;
      const proc = spawn('bash', ['-c', wrapped], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let output = '';
      let timeoutHandle: NodeJS.Timeout | null = null;

      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          proc.kill('SIGTERM');
          resolve({
            output: `Command timed out after ${timeout} seconds`,
            exitCode: 124,
          });
        }, timeout * 1000);
      }

      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        resolve({
          output: output || '',
          exitCode: code || 0,
        });
      });

      proc.on('error', (error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        resolve({
          output: `Error executing command: ${error.message}`,
          exitCode: 1,
        });
      });
    });
  }

  async executeBackground(cmd: string): Promise<void> {
    try {
      const wrapped = this.workingDir ? `cd '${this.workingDir}' && ${cmd}` : cmd;
      spawn('bash', ['-c', wrapped], {
        detached: true,
        stdio: 'ignore',
      });
    } catch (error) {
      console.error("[Background Error] Background Error Ignored")
    }
  }
}