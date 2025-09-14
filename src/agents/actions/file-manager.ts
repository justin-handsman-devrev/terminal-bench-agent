import { CommandExecutor } from '../../core/execution/command-executor';
import * as path from 'path';

export interface EditOperation {
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

export class FileManager {
  constructor(private executor: CommandExecutor) {}

  async readFile(filePath: string, offset?: number, limit?: number): Promise<[string, boolean]> {
    try {
      let cmd: string;
      
      if (offset !== undefined && limit !== undefined) {
        // Read specific range with line numbers
        cmd = `tail -n +${offset} '${filePath}' 2>&1 | head -n ${limit} | nl -ba -v ${offset}`;
      } else if (offset !== undefined) {
        // Read from offset to end with line numbers
        cmd = `tail -n +${offset} '${filePath}' 2>&1 | nl -ba -v ${offset}`;
      } else if (limit !== undefined) {
        // Read first N lines with line numbers
        cmd = `head -n ${limit} '${filePath}' 2>&1 | nl -ba`;
      } else {
        // Read entire file with line numbers
        cmd = `nl -ba '${filePath}' 2>&1`;
      }
      
      const result = await this.executor.execute(cmd);
      
      if (result.exitCode !== 0 || result.output.includes('No such file or directory')) {
        return [`File not found: ${filePath}`, true];
      }
      
      return [result.output, false];
    } catch (error) {
      return [`Error reading file: ${error}`, true];
    }
  }

  async writeFile(filePath: string, content: string): Promise<[string, boolean]> {
    try {
      // Create directory if it doesn't exist
      const dir = path.dirname(filePath);
      const mkdirResult = await this.executor.execute(`mkdir -p '${dir}'`);
      if (mkdirResult.exitCode !== 0) {
        return [`Error creating directory: ${mkdirResult.output}`, true];
      }

      // Create a temporary script file to write the content
      const tempScript = `/tmp/write_${Date.now()}.js`;
      const scriptContent = `
const fs = require('fs');

const filePath = process.argv[2];
const content = Buffer.from(process.argv[3], 'base64');

try {
  fs.writeFileSync(filePath, content);
  console.log('File written successfully');
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
      `;

      // Convert content to base64 for safe passing as argument
      const contentBase64 = Buffer.from(content, 'binary').toString('base64');

      // Write the script to a temporary file
      const base64Script = Buffer.from(scriptContent, 'utf-8').toString('base64');
      await this.executor.execute(`echo '${base64Script}' | base64 -d > '${tempScript}'`);
      
      // Execute the script
      const result = await this.executor.execute(`node '${tempScript}' '${filePath}' '${contentBase64}'`);
      
      // Clean up temporary script
      await this.executor.execute(`rm -f '${tempScript}'`);
      
      if (result.exitCode === 0) {
        return [`Successfully wrote to ${filePath} (${content.length} characters)`, false];
      } else {
        return [`Error writing file: ${result.output}`, true];
      }
    } catch (error) {
      return [`Error writing file: ${error}`, true];
    }
  }

  async editFile(filePath: string, oldString: string, newString: string, replaceAll: boolean = false): Promise<[string, boolean]> {
    try {
      // First, create a backup
      const backupResult = await this.executor.execute(`cp '${filePath}' '${filePath}.bak' 2>&1`);
      if (backupResult.exitCode !== 0) {
        if (backupResult.output.includes('No such file or directory')) {
          return [`File not found: ${filePath}`, true];
        }
        return [`Error creating backup: ${backupResult.output}`, true];
      }

      // Use Node.js for precise string replacement
      // Create a temporary script file to avoid escaping issues
      const tempScript = `/tmp/edit_${Date.now()}.js`;
      const regexEscapePattern = '/[.*+?^${}()|[\\\\]\\\\]/g';
      const scriptContent = `
const fs = require('fs');

const filePath = process.argv[2];
const oldString = process.argv[3];
const newString = process.argv[4];
const replaceAll = process.argv[5] === 'true';

try {
  let content = fs.readFileSync(filePath, 'utf-8');
  
  if (replaceAll) {
    // Escape special regex characters
    const escapedOld = oldString.replace(${regexEscapePattern}, '\\\\$&');
    const regex = new RegExp(escapedOld, 'g');
    content = content.replace(regex, newString);
  } else {
    const index = content.indexOf(oldString);
    if (index === -1) {
      console.error('String not found in file');
      process.exit(1);
    }
    content = content.substring(0, index) + newString + content.substring(index + oldString.length);
  }
  
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('File edited successfully');
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
      `;

      // Write the script to a temporary file
      const base64Script = Buffer.from(scriptContent, 'utf-8').toString('base64');
      await this.executor.execute(`echo '${base64Script}' | base64 -d > '${tempScript}'`);
      
      // Execute the script
      const result = await this.executor.execute(`node '${tempScript}' '${filePath}' ${JSON.stringify(oldString)} ${JSON.stringify(newString)} ${replaceAll}`);
      
      // Clean up temporary script and backup on success
      await this.executor.execute(`rm -f '${tempScript}' '${filePath}.bak'`);
      
      if (result.exitCode === 0) {
        return [`Successfully replaced "${oldString}" with "${newString}" in ${filePath}`, false];
      } else {
        // Restore backup on failure
        await this.executor.execute(`mv '${filePath}.bak' '${filePath}'`);
        return [`Error editing file: ${result.output}`, true];
      }
    } catch (error) {
      return [`Error editing file: ${error}`, true];
    }
  }

  async multiEditFile(filePath: string, edits: EditOperation[]): Promise<[string, boolean]> {
    try {
      // Apply edits sequentially
      for (const edit of edits) {
        const [result, isError] = await this.editFile(filePath, edit.oldString, edit.newString, edit.replaceAll);
        if (isError) {
          return [result, true];
        }
      }
      return [`Successfully applied ${edits.length} edits to ${filePath}`, false];
    } catch (error) {
      return [`Error applying multiple edits: ${error}`, true];
    }
  }

  async getMetadata(filePaths: string[]): Promise<[string, boolean]> {
    try {
      const results: string[] = [];
      
      // Limit to 10 files to avoid overwhelming output
      const limitedPaths = filePaths.slice(0, 10);
      
      for (const filePath of limitedPaths) {
        // Use stat command to get detailed file information
        const cmd = `stat -c '%s %Y %U:%G %a %F' '${filePath}' 2>/dev/null || echo 'not_found'`;
        const result = await this.executor.execute(cmd);
        
        if (result.output.trim() === 'not_found') {
          results.push(`${filePath}: Not found`);
        } else {
          const [size, mtime, owner, permissions, type] = result.output.trim().split(' ');
          const date = new Date(parseInt(mtime) * 1000).toISOString();
          results.push(`${filePath}: Size: ${size} bytes, Modified: ${date}, Owner: ${owner}, Permissions: ${permissions}, Type: ${type}`);
        }
      }
      
      if (filePaths.length > 10) {
        results.push(`... and ${filePaths.length - 10} more files (showing first 10)`);
      }
      
      return [results.join('\n'), false];
    } catch (error) {
      return [`Error getting file metadata: ${error}`, true];
    }
  }
}
