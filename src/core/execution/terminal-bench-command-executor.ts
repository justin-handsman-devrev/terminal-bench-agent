
import { spawn } from 'child_process';
import { ExecutionResult } from '../../types';
import { CommandExecutor } from './command-executor';

export class TerminalBenchExecutor extends CommandExecutor {
  async execute(cmd: string, timeout: number = 120): Promise<ExecutionResult> {
    const wrappedCmd = this.wrapCommandForTerminalBench(cmd);
    
    return new Promise((resolve) => {
      const proc = spawn('bash', ['-c', wrappedCmd], {
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

      // Collect output
      proc.stdout?.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      // Handle process completion
      proc.on('close', (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        resolve({
          output: output || '',
          exitCode: code || 0,
        });
      });

      // Handle process errors
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
      const wrappedCmd = this.wrapCommandForTerminalBench(cmd);
      spawn('bash', ['-c', wrappedCmd], {
        detached: true,
        stdio: 'ignore',
      });
    } catch (error) {
      // Background execution failures are silently ignored
    }
  }

  private wrapCommandForTerminalBench(cmd: string): string {
    // Wrap the command to ensure proper environment setup for Terminal-Bench
    const cd = this.workingDir ? `cd '${this.workingDir}'\n` : '';
    return `
# Set up Terminal-Bench environment
set -e

# Source NVM if available and use Node 20.19.3
if [ -f "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    nvm use 20.19.3 2>/dev/null || {
        echo "Installing Node.js 20.19.3..."
        nvm install 20.19.3
        nvm use 20.19.3
        nvm alias default 20.19.3
    }
fi

# Ensure we're using the correct Node version
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version)
    if [[ "$NODE_VERSION" != "v20.19.3" ]]; then
        echo "Warning: Expected Node v20.19.3, but found $NODE_VERSION"
        # Try to install the correct version if we have nvm
        if [ -f "$HOME/.nvm/nvm.sh" ]; then
            source "$HOME/.nvm/nvm.sh"
            nvm install 20.19.3
            nvm use 20.19.3
            nvm alias default 20.19.3
        fi
    fi
fi

# Set npm to use exact versions to avoid package drift
if command -v npm >/dev/null 2>&1; then
    npm config set save-exact true
fi

# Ensure uv (fast Python package manager) is available for one-shot Python runs
if ! command -v uv >/dev/null 2>&1; then
    echo "Installing uv (fast Python package manager) ..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# Change to working directory if provided
${cd}

# Execute the original command
${cmd}
`;
  }
}
