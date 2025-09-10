import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseTool } from './base-tool';
import { ToolContext, ToolResult } from '../types';

export class ReadFileTool extends BaseTool {
  name = 'read_file';
  description = 'Read the contents of a file';
  parameters = z.object({
    file_path: z.string().describe('Path to the file to read'),
    max_size: z.number().optional().describe('Maximum file size to read in KB (default: 500)')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { file_path, max_size = 500 } = this.validateParams<{
        file_path: string;
        max_size?: number;
      }>(params);

      const fullPath = path.resolve(context.repositoryPath, file_path);
      
      // Security check
      if (!fullPath.startsWith(context.repositoryPath)) {
        return this.createErrorResult('Access denied: Path outside repository');
      }

      if (!(await fs.pathExists(fullPath))) {
        return this.createErrorResult('File not found');
      }

      const stats = await fs.stat(fullPath);
      if (stats.size > max_size * 1024) {
        return this.createErrorResult(`File too large: ${Math.round(stats.size / 1024)}KB > ${max_size}KB`);
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      context.logger.debug(`Read file: ${file_path} (${stats.size} bytes)`);

      return this.createSuccessResult({
        content,
        size: stats.size,
        path: file_path
      });
    } catch (error: any) {
      return this.createErrorResult(`Failed to read file: ${error.message}`);
    }
  }
}

export class WriteFileTool extends BaseTool {
  name = 'write_file';
  description = 'Write content to a file';
  parameters = z.object({
    file_path: z.string().describe('Path to the file to write'),
    content: z.string().describe('Content to write to the file'),
    create_directories: z.boolean().default(true).describe('Create parent directories if they don\'t exist')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      if (!context.config.tools.enableFileOperations) {
        return this.createErrorResult('File operations are disabled');
      }

      const { file_path, content, create_directories } = this.validateParams<{
        file_path: string;
        content: string;
        create_directories: boolean;
      }>(params);

      const fullPath = path.resolve(context.repositoryPath, file_path);
      
      // Security check
      if (!fullPath.startsWith(context.repositoryPath)) {
        return this.createErrorResult('Access denied: Path outside repository');
      }

      if (create_directories) {
        await fs.ensureDir(path.dirname(fullPath));
      }

      await fs.writeFile(fullPath, content, 'utf-8');
      context.logger.debug(`Wrote file: ${file_path} (${content.length} chars)`);

      return this.createSuccessResult({
        path: file_path,
        size: content.length
      }, `Successfully wrote ${file_path}`);
    } catch (error: any) {
      return this.createErrorResult(`Failed to write file: ${error.message}`);
    }
  }
}

export class ListDirectoryTool extends BaseTool {
  name = 'list_directory';
  description = 'List files and directories in a given path';
  parameters = z.object({
    directory_path: z.string().default('.').describe('Path to the directory to list'),
    recursive: z.boolean().default(false).describe('List files recursively'),
    max_depth: z.number().default(3).describe('Maximum depth for recursive listing')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { directory_path, recursive, max_depth } = this.validateParams<{
        directory_path: string;
        recursive: boolean;
        max_depth: number;
      }>(params);

      const fullPath = path.resolve(context.repositoryPath, directory_path);
      
      // Security check
      if (!fullPath.startsWith(context.repositoryPath)) {
        return this.createErrorResult('Access denied: Path outside repository');
      }

      if (!(await fs.pathExists(fullPath))) {
        return this.createErrorResult('Directory not found');
      }

      const stats = await fs.stat(fullPath);
      if (!stats.isDirectory()) {
        return this.createErrorResult('Path is not a directory');
      }

      const listFiles = async (currentPath: string, depth: number = 0): Promise<any[]> => {
        if (depth > max_depth) return [];
        
        const entries = await fs.readdir(currentPath);
        const files: any[] = [];

        for (const entry of entries) {
          // Skip hidden files and common ignore patterns
          if (entry.startsWith('.') || entry === 'node_modules') continue;

          const entryPath = path.join(currentPath, entry);
          const entryStats = await fs.stat(entryPath);
          const relativePath = path.relative(context.repositoryPath, entryPath);

          const fileInfo: any = {
            name: entry,
            path: relativePath,
            type: entryStats.isDirectory() ? 'directory' : 'file',
            size: entryStats.size,
            modified: entryStats.mtime
          };

          files.push(fileInfo);

          if (recursive && entryStats.isDirectory() && depth < max_depth) {
            const children = await listFiles(entryPath, depth + 1);
            fileInfo.children = children;
          }
        }

        return files.sort((a, b) => {
          // Directories first, then files
          if (a.type !== b.type) {
            return a.type === 'directory' ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });
      };

      const files = await listFiles(fullPath);
      context.logger.debug(`Listed directory: ${directory_path} (${files.length} entries)`);

      return this.createSuccessResult({
        path: directory_path,
        entries: files
      });
    } catch (error: any) {
      return this.createErrorResult(`Failed to list directory: ${error.message}`);
    }
  }
}

export class SearchFilesTool extends BaseTool {
  name = 'search_files';
  description = 'Search for files matching a pattern';
  parameters = z.object({
    pattern: z.string().describe('Glob pattern to search for files'),
    content_search: z.union([z.string(), z.boolean()]).optional().describe('Search for files containing this text'),
    file_types: z.array(z.string()).optional().describe('Filter by file extensions (e.g., [".ts", ".js"])')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { pattern, content_search, file_types } = this.validateParams<{
        pattern: string;
        content_search?: string | boolean;
        file_types?: string[];
      }>(params);

      const { glob } = await import('glob');
      
      const searchPath = path.join(context.repositoryPath, pattern);
      let files = await glob(searchPath, {
        ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**']
      });

      // Filter by file types
      if (file_types && file_types.length > 0) {
        files = files.filter(file => 
          file_types.some(ext => file.endsWith(ext))
        );
      }

      const results = [];
      
      for (const file of files.slice(0, 50)) { // Limit to 50 results
        const relativePath = path.relative(context.repositoryPath, file);
        const stats = await fs.stat(file);
        
        let matches = true;
        let matchedLines: string[] = [];
        
        // Content search
        const contentSearchStr = typeof content_search === 'string' ? content_search : undefined;
        if (contentSearchStr && stats.isFile()) {
          try {
            const content = await fs.readFile(file, 'utf-8');
            const lines = content.split('\n');
            
            matchedLines = lines
              .map((line, index) => ({ line, index }))
              .filter(({ line }) => line.toLowerCase().includes(contentSearchStr.toLowerCase()))
              .slice(0, 5) // Limit to 5 matches per file
              .map(({ line, index }) => `${index + 1}: ${line.trim()}`);
              
            matches = matchedLines.length > 0;
          } catch {
            matches = false;
          }
        }
        
        if (matches) {
          results.push({
            path: relativePath,
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modified: stats.mtime,
            matches: matchedLines
          });
        }
      }

      context.logger.debug(`Found ${results.length} files matching pattern: ${pattern}`);

      return this.createSuccessResult({
        pattern,
        results,
        total: results.length
      });
    } catch (error: any) {
      return this.createErrorResult(`Failed to search files: ${error.message}`);
    }
  }
}
