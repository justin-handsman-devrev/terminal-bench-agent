import { CommandExecutor } from '../../core/execution/command-executor';

export class SearchManager {
  constructor(private executor: CommandExecutor) {}

  async grep(pattern: string, path?: string, include?: string): Promise<[string, boolean]> {
    const grepFlags = [
      '-r',
      '-n',
      '-H',
      '--color=never'
    ];

    if (include) {
      grepFlags.push(`--include='${include}'`);
    }

    const searchPath = path || '.';
    const escapedPattern = pattern.replace(/'/g, "'\"'\"'");
    const cmd = `grep ${grepFlags.join(' ')} '${escapedPattern}' '${searchPath}' 2>/dev/null | head -n 100`;
    const result = await this.executor.execute(cmd);

    if (result.exitCode === 1 && !result.output) {
      return ['No matches found', false];
    } else if (result.exitCode > 1) {
      return [`Error during search: ${result.output}`, true];
    }

    const lines = result.output.trim().split('\n').filter(line => line);
    if (lines.length === 100) {
      return [result.output + '\n\n[Output truncated to 100 matches]', false];
    }

    return [result.output || 'No matches found', false];
  }

  async glob(pattern: string, path?: string): Promise<[string, boolean]> {
    const searchPath = path || '.';
    const findPattern = pattern.replace(/\*\*\//g, '*/');
    const cmd = `find '${searchPath}' -name '${findPattern}' -type f 2>/dev/null | head -n 100 | sort`;
    const result = await this.executor.execute(cmd);

    if (result.exitCode !== 0) {
      return [`Error during file search: ${result.output}`, true];
    }

    const lines = result.output.trim().split('\n').filter(line => line);
    if (lines.length === 0) {
      return ['No files found matching pattern', false];
    }

    if (lines.length === 100) {
      return [result.output + '\n\n[Output truncated to 100 files]', false];
    }

    return [lines.join('\n'), false];
  }

  async ls(path: string, ignore: string[] = []): Promise<[string, boolean]> {
    const checkCmd = `test -d '${path}' && echo 'dir' || (test -e '${path}' && echo 'not_dir' || echo 'not_found')`;
    const checkResult = await this.executor.execute(checkCmd);

    if (checkResult.output.includes('not_found')) {
      return [`Path not found: ${path}`, true];
    } else if (checkResult.output.includes('not_dir')) {
      return [`Path is not a directory: ${path}`, true];
    }

    const lsCmd = `ls -la '${path}' 2>/dev/null`;
    const result = await this.executor.execute(lsCmd);

    if (result.exitCode !== 0) {
      return [`Error listing directory: ${result.output}`, true];
    }

    if (ignore.length > 0 && result.output) {
      const lines = result.output.trim().split('\n');
      const filteredLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith('total') || !line.trim()) {
          filteredLines.push(line);
          continue;
        }

        const parts = line.split(/\s+/);
        if (parts.length >= 9) {
          const filename = parts.slice(8).join(' ');

          let shouldIgnore = false;
          for (const pattern of ignore) {
            if (pattern.startsWith('*') && filename.endsWith(pattern.slice(1))) {
              shouldIgnore = true;
              break;
            } else if (pattern.endsWith('*') && filename.startsWith(pattern.slice(0, -1))) {
              shouldIgnore = true;
              break;
            } else if (filename.includes(pattern)) {
              shouldIgnore = true;
              break;
            }
          }

          if (!shouldIgnore) {
            filteredLines.push(line);
          }
        } else {
          filteredLines.push(line);
        }
      }

      return [filteredLines.join('\n'), false];
    }

    return [result.output, false];
  }
}
