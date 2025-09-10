import { z } from 'zod';

// Configuration schemas
export const ConfigSchema = z.object({
  openRouter: z.object({
    apiKey: z.string(),
    model: z.string().default('google/gemini-2.0-flash-experimental'),
    baseUrl: z.string().default('https://openrouter.ai/api/v1')
  }),
  agent: z.object({
    maxConcurrentAgents: z.number().default(3),
    maxContextLength: z.number().default(100000),
    temperature: z.number().default(0.1)
  }),
  tools: z.object({
    maxFileSizeKB: z.number().default(500),
    enableGitOperations: z.boolean().default(true),
    enableFileOperations: z.boolean().default(true)
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    logToFile: z.boolean().default(false)
  })
});

export type Config = z.infer<typeof ConfigSchema>;

// Core interfaces
export interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  execute(context: AgentContext): Promise<AgentResult>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute(params: any, context: ToolContext): Promise<ToolResult>;
}

export interface AgentContext {
  request: string;
  repositoryPath: string;
  availableTools: Tool[];
  conversation: ConversationMessage[];
  config: Config;
}

export interface ToolContext {
  repositoryPath: string;
  config: Config;
  logger: Logger;
}

export interface AgentResult {
  success: boolean;
  message: string;
  data?: any;
  toolsUsed?: string[];
  nextActions?: string[];
}

export interface ToolResult {
  success: boolean;
  data: any;
  message?: string;
  error?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface Logger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

// Repository analysis types
export interface FileInfo {
  path: string;
  type: 'file' | 'directory';
  size: number;
  lastModified: Date;
  language?: string;
  importance: number;
}

export interface RepositoryContext {
  rootPath: string;
  files: FileInfo[];
  structure: DirectoryTree;
  gitInfo?: GitInfo;
  dependencies: PackageInfo[];
  technologies: string[];
}

export interface DirectoryTree {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: DirectoryTree[];
}

export interface GitInfo {
  branch: string;
  hasUncommittedChanges: boolean;
  remoteUrl?: string;
  lastCommit: {
    hash: string;
    message: string;
    author: string;
    date: Date;
  };
}

export interface PackageInfo {
  type: 'npm' | 'pip' | 'cargo' | 'go' | 'maven' | 'other';
  file: string;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// LLM types
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ToolCall {
  name: string;
  parameters: Record<string, any>;
}

export interface StructuredOutput<T = any> {
  fieldNames: string[];
  dataTypes: Record<string, string>;
  data: T;
  prettyPrint?: boolean;
}

// TODO types
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  createdAt: string; // ISO string for portability
  updatedAt: string; // ISO string
}

export interface TodoListResponse {
  items: TodoItem[];
}
