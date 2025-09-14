import { spawn } from 'child_process';
import { ExecutionResult } from '../../types';
import { CommandExecutor } from './command-executor';

export class DockerExecutor extends CommandExecutor {
  constructor(private containerName: string, workingDir?: string) {
    super(workingDir);
  }

  async execute(cmd: string, timeout: number = 120): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const args = ['exec'];
      if (this.workingDir) {
        args.push('-w', this.workingDir);
      }
      args.push(this.containerName, 'bash', '-c', cmd);
      const proc = spawn('docker', args, {
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
      const args = ['exec'];
      if (this.workingDir) {
        args.push('-w', this.workingDir);
      }
      args.push('-d', this.containerName, 'bash', '-c', cmd);
      spawn('docker', args, {
        detached: true,
        stdio: 'ignore',
      });
    } catch (error) {
      console.error('[Background Error] Process Ignored')
    }
  }
}