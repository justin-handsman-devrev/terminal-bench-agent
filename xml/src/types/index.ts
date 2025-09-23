export interface ExecutionResult {
  output: string;
  exitCode: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{
    type: 'text';
    text: string;
  } | {
    type: 'image_url';
    image_url: {
      url: string;
    };
  }>;
}

export interface LLMResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AgentConfig {
  model?: string;
  temperature?: number;
  apiKey?: string;
  apiBase?: string;
  maxTokens?: number;
}

// OpenRouter Provider Routing Types
export interface OpenRouterMaxPrice {
  prompt?: number;
  completion?: number;
  request?: number;
  image?: number;
}

export interface OpenRouterProviderConfig {
  order?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: 'allow' | 'deny';
  only?: string[];
  ignore?: string[];
  quantizations?: ('int4' | 'int8' | 'fp4' | 'fp6' | 'fp8' | 'fp16' | 'bf16' | 'fp32' | 'unknown')[];
  sort?: 'price' | 'throughput' | 'latency';
  max_price?: OpenRouterMaxPrice;
}

export enum TaskStatus {
  CREATED = 'created',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum AgentType {
  EXPLORER = 'explorer',
  CODER = 'coder',
}

export interface ContextBootstrapItem {
  path: string;
  reason: string;
}

export interface ContextItem {
  id: string;
  content: string;
}

export interface SubagentMeta {
  trajectory?: LLMMessage[];
  numTurns?: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface SubagentReport {
  contexts: ContextItem[];
  comments: string;
  meta?: SubagentMeta;
}

export interface Context {
  id: string;
  content: string;
  reportedBy: string;
  taskId?: string;
  createdAt: string;
}

export interface Task {
  taskId: string;
  agentType: AgentType;
  title: string;
  description: string;
  contextRefs: string[];
  contextBootstrap: ContextBootstrapItem[];
  status: TaskStatus;
  createdAt: string;
  completedAt?: string;
  result?: Record<string, any>;
}

export interface Turn {
  llmOutput: string;
  actionsExecuted: any[];
  envResponses: string[];
  subagentTrajectories?: Record<string, Record<string, any>>;
}

export interface ConversationHistory {
  turns: Turn[];
  maxTurns: number;
}

export interface OrchestratorState {
  done: boolean;
  finishMessage?: string;
  tasks: Record<string, Task>;
  contextStore: Record<string, Context>;
  conversationHistory: ConversationHistory;
}
