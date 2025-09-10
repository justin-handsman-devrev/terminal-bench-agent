import { Tool } from '../types';
import { 
  ReadFileTool, 
  WriteFileTool, 
  ListDirectoryTool, 
  SearchFilesTool 
} from './file-tools';
import { 
  GitStatusTool, 
  GitDiffTool, 
  GitLogTool, 
  GitAddTool, 
  GitCommitTool 
} from './git-tools';
import { 
  AnalyzeCodeTool, 
  RefactorCodeTool 
} from './code-tools';
import { ApplyTextEditsTool, InsertTextTool } from './edit-tools';
import { TodoCreateTool, TodoUpdateTool, TodoCompleteTool, TodoListTool } from './todo-tools';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools(): void {
    // File tools
    this.register(new ReadFileTool());
    this.register(new WriteFileTool());
    this.register(new ListDirectoryTool());
    this.register(new SearchFilesTool());

    // Git tools
    this.register(new GitStatusTool());
    this.register(new GitDiffTool());
    this.register(new GitLogTool());
    this.register(new GitAddTool());
    this.register(new GitCommitTool());

    // Code analysis tools
    this.register(new AnalyzeCodeTool());
    this.register(new RefactorCodeTool());

    // Editing tools
    this.register(new ApplyTextEditsTool());
    this.register(new InsertTextTool());

    // TODO tools
    this.register(new TodoCreateTool());
    this.register(new TodoUpdateTool());
    this.register(new TodoCompleteTool());
    this.register(new TodoListTool());
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(toolName: string): void {
    this.tools.delete(toolName);
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getToolsByCategory(category: 'file' | 'git' | 'code' | 'analysis'): Tool[] {
    const categoryMap = {
      file: ['read_file', 'write_file', 'list_directory', 'search_files'],
      git: ['git_status', 'git_diff', 'git_log', 'git_add', 'git_commit'],
      code: ['analyze_code', 'refactor_code'],
      analysis: ['analyze_code']
    };

    const toolNames = categoryMap[category] || [];
    return toolNames.map(name => this.tools.get(name)).filter(Boolean) as Tool[];
  }

  getToolSpecs(): any[] {
    return this.getAllTools().map(tool => {
      // Convert tool to OpenAI function calling format
      if ('toOpenAIToolSpec' in tool && typeof tool.toOpenAIToolSpec === 'function') {
        return (tool as any).toOpenAIToolSpec();
      }

      // Fallback format
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      };
    });
  }
}

// Export all tools for individual use
export * from './base-tool';
export * from './file-tools';
export * from './git-tools';
export * from './code-tools';
