import { CommandExecutor } from '../../core/execution/command-executor';
import { ErrorClassifier, withRetry, RetryConfig } from './error-handler';
import * as path from 'path';
import winston from 'winston';

export interface EditOperation {
  oldString: string;
  newString: string;
  replaceAll: boolean;
}

export interface FileManagerConfig {
  enableSmartRetry?: boolean;
  maxRetryAttempts?: number;
}

export class FileManager {
  constructor(
    private executor: CommandExecutor,
    private config: FileManagerConfig = {}
  ) {}

  async readFile(filePath: string, offset?: number, limit?: number): Promise<[string, boolean]> {
    try {
      let cmd: string;
      
      if (offset !== undefined && limit !== undefined) {
        cmd = `tail -n +${offset} '${filePath}' 2>&1 | head -n ${limit} | nl -ba -v ${offset}`;
      } else if (offset !== undefined) {
        cmd = `tail -n +${offset} '${filePath}' 2>&1 | nl -ba -v ${offset}`;
      } else if (limit !== undefined) {
        cmd = `head -n ${limit} '${filePath}' 2>&1 | nl -ba`;
      } else {
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
      // Validate syntax before writing based on file extension
      const syntaxValidation = await this.validateSyntax(filePath, content);
      if (!syntaxValidation.isValid) {
        return [`[SYNTAX ERROR] ${this.getLanguageName(filePath)} syntax validation failed: ${syntaxValidation.error}\n\nProposed fix:\n${syntaxValidation.suggestedFix || 'Check syntax and formatting'}`, true];
      }

      const dir = path.dirname(filePath);
      
      // Create directory with retry for network filesystems
      if (this.config.enableSmartRetry !== false) {
        const retryConfig: RetryConfig = {
          maxAttempts: this.config.maxRetryAttempts || 3,
          onRetry: (attempt, error, waitMs) => {
            winston.info(`Retrying directory creation (attempt ${attempt + 1}): ${dir}`);
          }
        };
        
        try {
          await withRetry(async () => {
            const result = await this.executor.execute(`mkdir -p '${dir}'`);
            if (result.exitCode !== 0) {
              const error = new Error(result.output);
              (error as any).exitCode = result.exitCode;
              throw error;
            }
          }, retryConfig);
        } catch (error) {
          return [`Error creating directory: ${error}`, true];
        }
      } else {
        const mkdirResult = await this.executor.execute(`mkdir -p '${dir}'`);
        if (mkdirResult.exitCode !== 0) {
          return [`Error creating directory: ${mkdirResult.output}`, true];
        }
      }

      const nodeCheck = await this.executor.execute(`which node 2>/dev/null`);
      const hasNode = nodeCheck.exitCode === 0 && nodeCheck.output.trim() !== '';

      if (hasNode) {
        const tempScript = `/tmp/write_${Date.now()}.js`;
        const scriptContent = `
const fs = require('fs');

const filePath = process.argv[2];
const content = Buffer.from(process.argv[3], 'base64').toString('utf8');

try {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('File written successfully');
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
        `;

        const contentBase64 = Buffer.from(content, 'utf8').toString('base64');

        const base64Script = Buffer.from(scriptContent, 'utf-8').toString('base64');
        const writeScriptResult = await this.executor.execute(`echo '${base64Script}' | base64 -d > '${tempScript}' && chmod +x '${tempScript}'`);
        
        if (writeScriptResult.exitCode === 0) {
          const result = await this.executor.execute(`node '${tempScript}' '${filePath}' '${contentBase64}'`);
          
          await this.executor.execute(`rm -f '${tempScript}'`);
          
          if (result.exitCode === 0) {
            return [`Successfully wrote to ${filePath} (${content.length} characters)`, false];
          }
        }
      }

      const pythonCheck = await this.executor.execute(`which python3 || which python 2>/dev/null`);
      const hasPython = pythonCheck.exitCode === 0 && pythonCheck.output.trim() !== '';

      if (hasPython) {
        const pythonCmd = pythonCheck.output.trim().split('\n')[0];
        const contentBase64 = Buffer.from(content, 'utf-8').toString('base64');
        const pythonScript = `
import base64
import sys
try:
    content = base64.b64decode(sys.argv[1]).decode('utf-8')
    with open(sys.argv[2], 'w') as f:
        f.write(content)
    print('File written successfully')
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
`;
        const scriptBase64 = Buffer.from(pythonScript, 'utf-8').toString('base64');
        const result = await this.executor.execute(`echo '${scriptBase64}' | base64 -d | ${pythonCmd} - '${contentBase64}' '${filePath}'`);
        
        if (result.exitCode === 0) {
          return [`Successfully wrote to ${filePath} (${content.length} characters)`, false];
        }
      }

      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${filePath}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      const result = await this.executor.execute(catCmd);
      
        if (result.exitCode === 0) {
          const verifyResult = await this.executor.execute(`test -f '${filePath}' && echo 'exists' || echo 'not exists'`);
          if (verifyResult.output.trim() === 'exists') {
            // Additional verification for all supported languages
            const postWriteValidation = await this.validateSyntax(filePath, content);
            if (!postWriteValidation.isValid) {
              return [`File written but contains syntax errors: ${postWriteValidation.error}\n\nSuggested fix: ${postWriteValidation.suggestedFix}`, true];
            }
            return [`Successfully wrote to ${filePath} (${content.length} characters)`, false];
          } else {
            return [`Error: File was not created at ${filePath}`, true];
          }
        } else {
        const escapedContent = content
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "'\"'\"'")
          .replace(/\$/g, '\\$')
          .replace(/`/g, '\\`');
        
        const printfResult = await this.executor.execute(`printf '%s' '${escapedContent}' > '${filePath}'`);
        
        if (printfResult.exitCode === 0) {
          const verifyResult = await this.executor.execute(`test -f '${filePath}' && echo 'exists' || echo 'not exists'`);
          if (verifyResult.output.trim() === 'exists') {
            return [`Successfully wrote to ${filePath} (${content.length} characters)`, false];
          }
        }
        
        return [`Error writing file: ${result.output}`, true];
      }
    } catch (error) {
      return [`Error writing file: ${error}`, true];
    }
  }

  async editFile(filePath: string, oldString: string, newString: string, replaceAll: boolean = false): Promise<[string, boolean]> {
    try {
      const backupResult = await this.executor.execute(`cp '${filePath}' '${filePath}.bak' 2>&1`);
      if (backupResult.exitCode !== 0) {
        if (backupResult.output.includes('No such file or directory')) {
          return [`File not found: ${filePath}`, true];
        }
        return [`Error creating backup: ${backupResult.output}`, true];
      }

      const nodeCheck = await this.executor.execute(`which node 2>/dev/null`);
      const hasNode = nodeCheck.exitCode === 0 && nodeCheck.output.trim() !== '';

      if (hasNode) {
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

        const base64Script = Buffer.from(scriptContent, 'utf-8').toString('base64');
        await this.executor.execute(`echo '${base64Script}' | base64 -d > '${tempScript}'`);
        
        const result = await this.executor.execute(`node '${tempScript}' '${filePath}' ${JSON.stringify(oldString)} ${JSON.stringify(newString)} ${replaceAll}`);
        
        await this.executor.execute(`rm -f '${tempScript}'`);
        
        if (result.exitCode === 0) {
          await this.executor.execute(`rm -f '${filePath}.bak'`);
          return [`Successfully replaced "${oldString}" with "${newString}" in ${filePath}`, false];
        }
      }

      const pythonCheck = await this.executor.execute(`which python3 || which python 2>/dev/null`);
      const hasPython = pythonCheck.exitCode === 0 && pythonCheck.output.trim() !== '';

      if (hasPython) {
        const pythonCmd = pythonCheck.output.trim().split('\n')[0];
        const oldBase64 = Buffer.from(oldString, 'utf-8').toString('base64');
        const newBase64 = Buffer.from(newString, 'utf-8').toString('base64');
        
        const pythonScript = `
import base64
import sys

try:
    file_path = sys.argv[1]
    old_string = base64.b64decode(sys.argv[2]).decode('utf-8')
    new_string = base64.b64decode(sys.argv[3]).decode('utf-8')
    replace_all = sys.argv[4] == 'true'
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    if replace_all:
        if old_string not in content:
            print('String not found in file', file=sys.stderr)
            sys.exit(1)
        content = content.replace(old_string, new_string)
    else:
        index = content.find(old_string)
        if index == -1:
            print('String not found in file', file=sys.stderr)
            sys.exit(1)
        content = content[:index] + new_string + content[index + len(old_string):]
    
    with open(file_path, 'w') as f:
        f.write(content)
    
    print('File edited successfully')
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
`;
        const scriptBase64 = Buffer.from(pythonScript, 'utf-8').toString('base64');
        const result = await this.executor.execute(
          `echo '${scriptBase64}' | base64 -d | ${pythonCmd} - '${filePath}' '${oldBase64}' '${newBase64}' ${replaceAll}`
        );
        
        if (result.exitCode === 0) {
          await this.executor.execute(`rm -f '${filePath}.bak'`);
          return [`Successfully replaced "${oldString}" with "${newString}" in ${filePath}`, false];
        }
      }

      if (!oldString.includes('\n') && !newString.includes('\n')) {
        const sedOld = oldString.replace(/[[\]{}()*+?.\\^$|#\s]/g, '\\$&').replace(/'/g, "'\"'\"'");
        const sedNew = newString.replace(/[[\]{}()*+?.\\^$|#\s]/g, '\\$&').replace(/'/g, "'\"'\"'");
        
        let sedCmd: string;
        if (replaceAll) {
          sedCmd = `sed -i '' 's/${sedOld}/${sedNew}/g' '${filePath}' 2>/dev/null || sed -i 's/${sedOld}/${sedNew}/g' '${filePath}'`;
        } else {
          sedCmd = `sed -i '' '0,/${sedOld}/s//${sedNew}/' '${filePath}' 2>/dev/null || sed -i '0,/${sedOld}/s//${sedNew}/' '${filePath}'`;
        }
        
        const result = await this.executor.execute(sedCmd);
        
        if (result.exitCode === 0) {
          const verifyCmd = `grep -F '${newString.replace(/'/g, "'\"'\"'")}' '${filePath}' >/dev/null 2>&1`;
          const verifyResult = await this.executor.execute(verifyCmd);
          
          if (verifyResult.exitCode === 0) {
            await this.executor.execute(`rm -f '${filePath}.bak'`);
            return [`Successfully replaced "${oldString}" with "${newString}" in ${filePath}`, false];
          }
        }
      }

      await this.executor.execute(`mv '${filePath}.bak' '${filePath}'`);
      return [`Error editing file: All methods failed. String may not exist in file or contain special characters.`, true];
    } catch (error) {
      await this.executor.execute(`mv '${filePath}.bak' '${filePath}' 2>/dev/null`);
      return [`Error editing file: ${error}`, true];
    }
  }

  async multiEditFile(filePath: string, edits: EditOperation[]): Promise<[string, boolean]> {
    try {
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
      
      const limitedPaths = filePaths.slice(0, 10);
      
      for (const filePath of limitedPaths) {
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

  private getLanguageName(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      'py': 'Python',
      'js': 'JavaScript',
      'ts': 'TypeScript', 
      'java': 'Java',
      'c': 'C',
      'cpp': 'C++',
      'cc': 'C++',
      'cxx': 'C++',
      'hpp': 'C++',
      'h': 'C/C++',
      'go': 'Go',
      'rs': 'Rust',
      'rb': 'Ruby',
      'cs': 'C#'
    };
    return languageMap[ext || ''] || 'Unknown';
  }

  private async validateSyntax(filePath: string, content: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    const ext = filePath.split('.').pop()?.toLowerCase();
    
    switch (ext) {
      case 'py':
        return this.validatePythonSyntax(content);
      case 'js':
      case 'mjs':
        return this.validateJavaScriptSyntax(content);
      case 'ts':
        return this.validateTypeScriptSyntax(content);
      case 'java':
        return this.validateJavaSyntax(content, filePath);
      case 'c':
        return this.validateCSyntax(content);
      case 'cpp':
      case 'cc':
      case 'cxx':
        return this.validateCppSyntax(content);
      case 'go':
        return this.validateGoSyntax(content);
      case 'rs':
        return this.validateRustSyntax(content);
      case 'rb':
        return this.validateRubySyntax(content);
      case 'cs':
        return this.validateCSharpSyntax(content);
      default:
        return { isValid: true }; // Skip validation for unsupported types
    }
  }

  private async validatePythonSyntax(content: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    try {
      const tempFile = `/tmp/syntax_check_${Date.now()}.py`;
      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${tempFile}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      const writeResult = await this.executor.execute(catCmd);
      if (writeResult.exitCode !== 0) {
        return { isValid: false, error: 'Failed to write temp file for syntax validation' };
      }

      const checkResult = await this.executor.execute(`python3 -m py_compile '${tempFile}' 2>&1`);
      await this.executor.execute(`rm -f '${tempFile}'`);

      if (checkResult.exitCode === 0) {
        return { isValid: true };
      }

      const error = checkResult.output;
      let suggestedFix = '';

      if (error.includes('IndentationError')) {
        suggestedFix = 'Fix indentation - ensure consistent use of spaces (not tabs) and proper nesting';
        if (error.includes('unexpected indent')) {
          suggestedFix += '. Remove extra indentation at the problematic line.';
        } else if (error.includes('expected an indented block')) {
          suggestedFix += '. Add proper indentation after colons (:).';
        }
      } else if (error.includes('SyntaxError')) {
        if (error.includes('invalid syntax')) {
          suggestedFix = 'Check for missing parentheses, brackets, or quotes';
        } else if (error.includes('EOF while scanning')) {
          suggestedFix = 'Check for unclosed strings or parentheses';
        }
      }

      return { isValid: false, error: error.trim(), suggestedFix };
    } catch (error) {
      return { isValid: false, error: `Syntax validation failed: ${error}` };
    }
  }

  private async validateJavaScriptSyntax(content: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    try {
      const tempFile = `/tmp/syntax_check_${Date.now()}.js`;
      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${tempFile}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      await this.executor.execute(catCmd);

      // Try Node.js syntax check first
      const nodeCheck = await this.executor.execute(`which node 2>/dev/null`);
      if (nodeCheck.exitCode === 0) {
        const checkResult = await this.executor.execute(`node --check '${tempFile}' 2>&1`);
        await this.executor.execute(`rm -f '${tempFile}'`);
        
        if (checkResult.exitCode === 0) {
          return { isValid: true };
        }
        
        return {
          isValid: false,
          error: checkResult.output.trim(),
          suggestedFix: 'Check for missing semicolons, unmatched brackets, or incorrect ES6+ syntax'
        };
      }

      // Fallback: basic syntax pattern check
      await this.executor.execute(`rm -f '${tempFile}'`);
      const basicValidation = this.basicJavaScriptValidation(content);
      return basicValidation;
      
    } catch (error) {
      return { isValid: false, error: `JavaScript validation failed: ${error}` };
    }
  }

  private async validateTypeScriptSyntax(content: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    try {
      const tempFile = `/tmp/syntax_check_${Date.now()}.ts`;
      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${tempFile}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      await this.executor.execute(catCmd);

      // Try TypeScript compiler check
      const tscCheck = await this.executor.execute(`which tsc 2>/dev/null || which npx 2>/dev/null`);
      if (tscCheck.exitCode === 0) {
        const checkResult = await this.executor.execute(`npx tsc --noEmit --skipLibCheck '${tempFile}' 2>&1 || tsc --noEmit --skipLibCheck '${tempFile}' 2>&1`);
        await this.executor.execute(`rm -f '${tempFile}'`);
        
        if (checkResult.exitCode === 0) {
          return { isValid: true };
        }
        
        return {
          isValid: false,
          error: checkResult.output.trim(),
          suggestedFix: 'Check TypeScript syntax, type annotations, and imports'
        };
      }

      // Fallback to JavaScript validation
      await this.executor.execute(`rm -f '${tempFile}'`);
      return this.validateJavaScriptSyntax(content);
      
    } catch (error) {
      return { isValid: false, error: `TypeScript validation failed: ${error}` };
    }
  }

  private async validateJavaSyntax(content: string, filePath: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    try {
      const tempFile = `/tmp/syntax_check_${Date.now()}.java`;
      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${tempFile}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      await this.executor.execute(catCmd);

      const javacCheck = await this.executor.execute(`which javac 2>/dev/null`);
      if (javacCheck.exitCode === 0) {
        const checkResult = await this.executor.execute(`javac -cp . '${tempFile}' 2>&1`);
        await this.executor.execute(`rm -f '${tempFile}' '${tempFile.replace('.java', '.class')}'`);
        
        if (checkResult.exitCode === 0) {
          return { isValid: true };
        }
        
        return {
          isValid: false,
          error: checkResult.output.trim(),
          suggestedFix: 'Check Java syntax, missing semicolons, unmatched braces, or package declarations'
        };
      }

      await this.executor.execute(`rm -f '${tempFile}'`);
      return { isValid: true }; // Skip if compiler not available
      
    } catch (error) {
      return { isValid: false, error: `Java validation failed: ${error}` };
    }
  }

  private async validateCSyntax(content: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    try {
      const tempFile = `/tmp/syntax_check_${Date.now()}.c`;
      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${tempFile}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      await this.executor.execute(catCmd);

      const gccCheck = await this.executor.execute(`which gcc 2>/dev/null`);
      if (gccCheck.exitCode === 0) {
        const checkResult = await this.executor.execute(`gcc -fsyntax-only '${tempFile}' 2>&1`);
        await this.executor.execute(`rm -f '${tempFile}'`);
        
        if (checkResult.exitCode === 0) {
          return { isValid: true };
        }
        
        return {
          isValid: false,
          error: checkResult.output.trim(),
          suggestedFix: 'Check C syntax, missing semicolons, unmatched braces, or include statements'
        };
      }

      await this.executor.execute(`rm -f '${tempFile}'`);
      return { isValid: true };
      
    } catch (error) {
      return { isValid: false, error: `C validation failed: ${error}` };
    }
  }

  private async validateCppSyntax(content: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    try {
      const tempFile = `/tmp/syntax_check_${Date.now()}.cpp`;
      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${tempFile}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      await this.executor.execute(catCmd);

      const gppCheck = await this.executor.execute(`which g++ 2>/dev/null`);
      if (gppCheck.exitCode === 0) {
        const checkResult = await this.executor.execute(`g++ -fsyntax-only -std=c++17 '${tempFile}' 2>&1`);
        await this.executor.execute(`rm -f '${tempFile}'`);
        
        if (checkResult.exitCode === 0) {
          return { isValid: true };
        }
        
        return {
          isValid: false,
          error: checkResult.output.trim(),
          suggestedFix: 'Check C++ syntax, missing semicolons, template syntax, or namespace declarations'
        };
      }

      await this.executor.execute(`rm -f '${tempFile}'`);
      return { isValid: true };
      
    } catch (error) {
      return { isValid: false, error: `C++ validation failed: ${error}` };
    }
  }

  private async validateGoSyntax(content: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    try {
      const tempFile = `/tmp/syntax_check_${Date.now()}.go`;
      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${tempFile}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      await this.executor.execute(catCmd);

      const goCheck = await this.executor.execute(`which go 2>/dev/null`);
      if (goCheck.exitCode === 0) {
        // First try go fmt for syntax check
        const fmtResult = await this.executor.execute(`go fmt '${tempFile}' 2>&1`);
        if (fmtResult.exitCode !== 0) {
          await this.executor.execute(`rm -f '${tempFile}'`);
          return {
            isValid: false,
            error: fmtResult.output.trim(),
            suggestedFix: 'Check Go syntax, missing braces, or incorrect package declarations'
          };
        }

        // Then try compilation check
        const buildResult = await this.executor.execute(`go build -o /dev/null '${tempFile}' 2>&1`);
        await this.executor.execute(`rm -f '${tempFile}'`);
        
        if (buildResult.exitCode === 0) {
          return { isValid: true };
        }
        
        return {
          isValid: false,
          error: buildResult.output.trim(),
          suggestedFix: 'Check Go compilation errors, imports, or type mismatches'
        };
      }

      await this.executor.execute(`rm -f '${tempFile}'`);
      return { isValid: true };
      
    } catch (error) {
      return { isValid: false, error: `Go validation failed: ${error}` };
    }
  }

  private async validateRustSyntax(content: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    try {
      const tempFile = `/tmp/syntax_check_${Date.now()}.rs`;
      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${tempFile}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      await this.executor.execute(catCmd);

      const rustcCheck = await this.executor.execute(`which rustc 2>/dev/null`);
      if (rustcCheck.exitCode === 0) {
        const checkResult = await this.executor.execute(`rustc --emit=metadata --crate-type lib '${tempFile}' -o /dev/null 2>&1`);
        await this.executor.execute(`rm -f '${tempFile}'`);
        
        if (checkResult.exitCode === 0) {
          return { isValid: true };
        }
        
        return {
          isValid: false,
          error: checkResult.output.trim(),
          suggestedFix: 'Check Rust syntax, lifetime annotations, or borrow checker issues'
        };
      }

      await this.executor.execute(`rm -f '${tempFile}'`);
      return { isValid: true };
      
    } catch (error) {
      return { isValid: false, error: `Rust validation failed: ${error}` };
    }
  }

  private async validateRubySyntax(content: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    try {
      const tempFile = `/tmp/syntax_check_${Date.now()}.rb`;
      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${tempFile}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      await this.executor.execute(catCmd);

      const rubyCheck = await this.executor.execute(`which ruby 2>/dev/null`);
      if (rubyCheck.exitCode === 0) {
        const checkResult = await this.executor.execute(`ruby -c '${tempFile}' 2>&1`);
        await this.executor.execute(`rm -f '${tempFile}'`);
        
        if (checkResult.exitCode === 0) {
          return { isValid: true };
        }
        
        return {
          isValid: false,
          error: checkResult.output.trim(),
          suggestedFix: 'Check Ruby syntax, missing end statements, or block syntax'
        };
      }

      await this.executor.execute(`rm -f '${tempFile}'`);
      return { isValid: true };
      
    } catch (error) {
      return { isValid: false, error: `Ruby validation failed: ${error}` };
    }
  }

  private async validateCSharpSyntax(content: string): Promise<{
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  }> {
    try {
      const tempFile = `/tmp/syntax_check_${Date.now()}.cs`;
      const tempMarker = `EOF_${Date.now()}`;
      const catCmd = `cat > '${tempFile}' << '${tempMarker}'\n${content}\n${tempMarker}`;
      
      await this.executor.execute(catCmd);

      const dotnetCheck = await this.executor.execute(`which dotnet 2>/dev/null || which mcs 2>/dev/null`);
      if (dotnetCheck.exitCode === 0) {
        // Try .NET Core first
        const dotnetResult = await this.executor.execute(`dotnet build '${tempFile}' 2>&1`);
        if (dotnetResult.exitCode === 0) {
          await this.executor.execute(`rm -f '${tempFile}'`);
          return { isValid: true };
        }

        // Fallback to Mono compiler
        const mcsResult = await this.executor.execute(`mcs -target:library '${tempFile}' 2>&1`);
        await this.executor.execute(`rm -f '${tempFile}' '${tempFile.replace('.cs', '.dll')}'`);
        
        if (mcsResult.exitCode === 0) {
          return { isValid: true };
        }
        
        const error = dotnetResult.output || mcsResult.output;
        return {
          isValid: false,
          error: error.trim(),
          suggestedFix: 'Check C# syntax, missing semicolons, namespace declarations, or using statements'
        };
      }

      await this.executor.execute(`rm -f '${tempFile}'`);
      return { isValid: true };
      
    } catch (error) {
      return { isValid: false, error: `C# validation failed: ${error}` };
    }
  }

  private basicJavaScriptValidation(content: string): {
    isValid: boolean;
    error?: string;
    suggestedFix?: string;
  } {
    // Basic syntax checks when Node.js is not available
    const issues: string[] = [];
    
    // Check for common syntax issues
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for unmatched brackets/braces
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      const openParens = (line.match(/\(/g) || []).length;
      const closeParens = (line.match(/\)/g) || []).length;
      const openBrackets = (line.match(/\[/g) || []).length;
      const closeBrackets = (line.match(/\]/g) || []).length;
      
      if (openBraces > closeBraces + 1 || closeBraces > openBraces + 1) {
        issues.push(`Line ${i + 1}: Possibly unmatched braces`);
      }
      if (openParens > closeParens + 1 || closeParens > openParens + 1) {
        issues.push(`Line ${i + 1}: Possibly unmatched parentheses`);
      }
      if (openBrackets > closeBrackets + 1 || closeBrackets > openBrackets + 1) {
        issues.push(`Line ${i + 1}: Possibly unmatched brackets`);
      }
    }
    
    if (issues.length > 0) {
      return {
        isValid: false,
        error: issues.join('\n'),
        suggestedFix: 'Check for unmatched brackets, braces, or parentheses'
      };
    }
    
    return { isValid: true };
  }
}
