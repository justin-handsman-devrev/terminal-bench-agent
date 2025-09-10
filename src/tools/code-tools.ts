import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseTool } from './base-tool';
import { ToolContext, ToolResult } from '../types';

export class AnalyzeCodeTool extends BaseTool {
  name = 'analyze_code';
  description = 'Analyze code structure and extract information like functions, classes, imports';
  parameters = z.object({
    file_path: z.string().describe('Path to the file to analyze'),
    extract_functions: z.boolean().default(true).describe('Extract function definitions'),
    extract_classes: z.boolean().default(true).describe('Extract class definitions'),
    extract_imports: z.boolean().default(true).describe('Extract import statements'),
    extract_types: z.boolean().default(true).describe('Extract type definitions')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { 
        file_path, 
        extract_functions, 
        extract_classes, 
        extract_imports, 
        extract_types 
      } = this.validateParams<{
        file_path: string;
        extract_functions: boolean;
        extract_classes: boolean;
        extract_imports: boolean;
        extract_types: boolean;
      }>(params);

      const fullPath = path.resolve(context.repositoryPath, file_path);
      
      if (!fullPath.startsWith(context.repositoryPath)) {
        return this.createErrorResult('Access denied: Path outside repository');
      }

      if (!(await fs.pathExists(fullPath))) {
        return this.createErrorResult('File not found');
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      const lines = content.split('\n');
      const extension = path.extname(file_path).toLowerCase();

      const analysis = {
        file_path,
        language: this.detectLanguage(extension),
        line_count: lines.length,
        character_count: content.length,
        functions: extract_functions ? this.extractFunctions(content, extension) : [],
        classes: extract_classes ? this.extractClasses(content, extension) : [],
        imports: extract_imports ? this.extractImports(content, extension) : [],
        types: extract_types ? this.extractTypes(content, extension) : [],
        complexity: this.calculateComplexity(content, extension)
      };

      context.logger.debug(`Analyzed code: ${file_path} (${analysis.functions.length} functions, ${analysis.classes.length} classes)`);

      return this.createSuccessResult(analysis);
    } catch (error: any) {
      return this.createErrorResult(`Failed to analyze code: ${error.message}`);
    }
  }

  private detectLanguage(extension: string): string {
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.php': 'php',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.swift': 'swift'
    };
    return languageMap[extension] || 'unknown';
  }

  private extractFunctions(content: string, extension: string): any[] {
    const functions: any[] = [];
    const lines = content.split('\n');

    // TypeScript/JavaScript function patterns
    if (['.ts', '.tsx', '.js', '.jsx'].includes(extension)) {
      const functionPatterns = [
        /^\s*function\s+(\w+)\s*\([^)]*\)/,
        /^\s*const\s+(\w+)\s*=\s*\([^)]*\)\s*=>/,
        /^\s*(\w+)\s*\([^)]*\)\s*\{/,
        /^\s*async\s+function\s+(\w+)\s*\([^)]*\)/,
        /^\s*export\s+function\s+(\w+)\s*\([^)]*\)/
      ];

      lines.forEach((line, index) => {
        functionPatterns.forEach(pattern => {
          const match = line.match(pattern);
          if (match) {
            functions.push({
              name: match[1],
              line: index + 1,
              signature: line.trim()
            });
          }
        });
      });
    }

    // Python function patterns
    if (extension === '.py') {
      const pythonFunctionPattern = /^\s*def\s+(\w+)\s*\([^)]*\):/;
      lines.forEach((line, index) => {
        const match = line.match(pythonFunctionPattern);
        if (match) {
          functions.push({
            name: match[1],
            line: index + 1,
            signature: line.trim()
          });
        }
      });
    }

    return functions;
  }

  private extractClasses(content: string, extension: string): any[] {
    const classes: any[] = [];
    const lines = content.split('\n');

    // TypeScript/JavaScript class patterns
    if (['.ts', '.tsx', '.js', '.jsx'].includes(extension)) {
      const classPatterns = [
        /^\s*class\s+(\w+)/,
        /^\s*export\s+class\s+(\w+)/,
        /^\s*abstract\s+class\s+(\w+)/
      ];

      lines.forEach((line, index) => {
        classPatterns.forEach(pattern => {
          const match = line.match(pattern);
          if (match) {
            classes.push({
              name: match[1],
              line: index + 1,
              signature: line.trim()
            });
          }
        });
      });
    }

    // Python class patterns
    if (extension === '.py') {
      const pythonClassPattern = /^\s*class\s+(\w+)/;
      lines.forEach((line, index) => {
        const match = line.match(pythonClassPattern);
        if (match) {
          classes.push({
            name: match[1],
            line: index + 1,
            signature: line.trim()
          });
        }
      });
    }

    return classes;
  }

  private extractImports(content: string, extension: string): any[] {
    const imports: any[] = [];
    const lines = content.split('\n');

    // TypeScript/JavaScript import patterns
    if (['.ts', '.tsx', '.js', '.jsx'].includes(extension)) {
      const importPatterns = [
        /^\s*import\s+.*\s+from\s+['"]([^'"]+)['"]/,
        /^\s*import\s+['"]([^'"]+)['"]/,
        /^\s*const\s+.*\s*=\s*require\(['"]([^'"]+)['"]\)/
      ];

      lines.forEach((line, index) => {
        importPatterns.forEach(pattern => {
          const match = line.match(pattern);
          if (match) {
            imports.push({
              module: match[1],
              line: index + 1,
              statement: line.trim()
            });
          }
        });
      });
    }

    // Python import patterns
    if (extension === '.py') {
      const pythonImportPatterns = [
        /^\s*import\s+(\w+)/,
        /^\s*from\s+(\w+)\s+import/
      ];

      lines.forEach((line, index) => {
        pythonImportPatterns.forEach(pattern => {
          const match = line.match(pattern);
          if (match) {
            imports.push({
              module: match[1],
              line: index + 1,
              statement: line.trim()
            });
          }
        });
      });
    }

    return imports;
  }

  private extractTypes(content: string, extension: string): any[] {
    const types: any[] = [];
    
    if (['.ts', '.tsx'].includes(extension)) {
      const lines = content.split('\n');
      const typePatterns = [
        /^\s*type\s+(\w+)\s*=/,
        /^\s*interface\s+(\w+)/,
        /^\s*enum\s+(\w+)/
      ];

      lines.forEach((line, index) => {
        typePatterns.forEach(pattern => {
          const match = line.match(pattern);
          if (match) {
            types.push({
              name: match[1],
              line: index + 1,
              signature: line.trim()
            });
          }
        });
      });
    }

    return types;
  }

  private calculateComplexity(content: string, extension: string): number {
    let complexity = 1; // Base complexity

    // Count decision points
    const decisionKeywords = ['if', 'else', 'switch', 'case', 'for', 'while', 'catch', 'try'];
    decisionKeywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = content.match(regex);
      if (matches) {
        complexity += matches.length;
      }
    });

    return complexity;
  }
}

export class RefactorCodeTool extends BaseTool {
  name = 'refactor_code';
  description = 'Apply refactoring operations to code';
  parameters = z.object({
    file_path: z.string().describe('Path to the file to refactor'),
    operation: z.enum(['rename_variable', 'extract_function', 'inline_variable', 'move_function']).describe('Type of refactoring to perform'),
    old_name: z.string().describe('Current name (for rename operations)'),
    new_name: z.string().describe('New name (for rename operations)'),
    start_line: z.number().optional().describe('Start line for extraction operations'),
    end_line: z.number().optional().describe('End line for extraction operations')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      if (!context.config.tools.enableFileOperations) {
        return this.createErrorResult('File operations are disabled');
      }

      const { 
        file_path, 
        operation, 
        old_name, 
        new_name, 
        start_line, 
        end_line 
      } = this.validateParams<{
        file_path: string;
        operation: string;
        old_name: string;
        new_name: string;
        start_line?: number;
        end_line?: number;
      }>(params);

      const fullPath = path.resolve(context.repositoryPath, file_path);
      
      if (!fullPath.startsWith(context.repositoryPath)) {
        return this.createErrorResult('Access denied: Path outside repository');
      }

      if (!(await fs.pathExists(fullPath))) {
        return this.createErrorResult('File not found');
      }

      const originalContent = await fs.readFile(fullPath, 'utf-8');
      let refactoredContent = originalContent;

      switch (operation) {
        case 'rename_variable':
          refactoredContent = this.renameVariable(originalContent, old_name, new_name);
          break;
        case 'extract_function':
          if (start_line && end_line) {
            refactoredContent = this.extractFunction(originalContent, new_name, start_line, end_line);
          } else {
            return this.createErrorResult('start_line and end_line required for extract_function');
          }
          break;
        default:
          return this.createErrorResult(`Unsupported refactoring operation: ${operation}`);
      }

      // Write the refactored content back
      await fs.writeFile(fullPath, refactoredContent, 'utf-8');

      context.logger.debug(`Applied ${operation} refactoring to ${file_path}`);

      return this.createSuccessResult({
        operation,
        file_path,
        changes_made: originalContent !== refactoredContent,
        old_length: originalContent.length,
        new_length: refactoredContent.length
      }, `Successfully applied ${operation} to ${file_path}`);
    } catch (error: any) {
      return this.createErrorResult(`Failed to refactor code: ${error.message}`);
    }
  }

  private renameVariable(content: string, oldName: string, newName: string): string {
    // Simple word boundary replacement - more sophisticated AST-based refactoring would be better
    const regex = new RegExp(`\\b${oldName}\\b`, 'g');
    return content.replace(regex, newName);
  }

  private extractFunction(content: string, functionName: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    
    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
      throw new Error('Invalid line range for extraction');
    }

    // Extract the selected lines
    const extractedLines = lines.slice(startLine - 1, endLine);
    const extractedCode = extractedLines.join('\n');

    // Create the new function
    const newFunction = `\nfunction ${functionName}() {\n${extractedCode}\n}\n`;

    // Replace the original lines with a function call
    const functionCall = `  ${functionName}();`;
    
    const newLines = [
      ...lines.slice(0, startLine - 1),
      functionCall,
      ...lines.slice(endLine),
      newFunction
    ];

    return newLines.join('\n');
  }
}
