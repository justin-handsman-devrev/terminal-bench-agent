// Core exports
export * from './core/config';
export * from './core/logger';
export * from './core/llm-client';
export * from './core/repository-analyzer';

// Types
export * from './types';

// Agents
export * from './agents';

// Tools
export * from './tools';

// CLI
export * from './cli/commands';

// Main application class
import { ConfigManager } from './core/config';
import { ConsoleLogger } from './core/logger';
import { OpenRouterClient } from './core/llm-client';
import { ToolRegistry } from './tools';
import { AgentOrchestrator } from './agents/orchestrator';
import { Config, AgentResult, ConversationMessage } from './types';

export class DevRevCoderAgent {
  private config: Config;
  private logger: ConsoleLogger;
  private llmClient: OpenRouterClient;
  private toolRegistry: ToolRegistry;
  private orchestrator: AgentOrchestrator;

  constructor(configOverrides?: Partial<Config>) {
    this.config = ConfigManager.getInstance().getConfig();
    
    // Apply any config overrides
    if (configOverrides) {
      this.config = { ...this.config, ...configOverrides };
    }

    this.logger = new ConsoleLogger(this.config);
    this.llmClient = new OpenRouterClient(this.config, this.logger);
    this.toolRegistry = new ToolRegistry();
    this.orchestrator = new AgentOrchestrator(this.config, this.toolRegistry, this.llmClient, this.logger);

    this.logger.debug('DevRev Coder Agent initialized');
  }

  async executeRequest(
    request: string, 
    repositoryPath: string = process.cwd(),
    conversationHistory?: ConversationMessage[]
  ): Promise<AgentResult> {
    return this.orchestrator.executeRequest(request, repositoryPath, conversationHistory);
  }

  async executeWithMultipleAgents(
    request: string,
    repositoryPath: string = process.cwd(),
    conversationHistory?: ConversationMessage[]
  ): Promise<AgentResult[]> {
    return this.orchestrator.executeWithMultipleAgents(request, repositoryPath, conversationHistory);
  }

  async getAgentRecommendation(request: string) {
    return this.orchestrator.getAgentRecommendation(request);
  }

  getAvailableAgents() {
    return this.orchestrator.getAvailableAgents();
  }

  getAvailableTools() {
    return this.toolRegistry.getAllTools();
  }

  getConfig() {
    return this.config;
  }

  getLogger() {
    return this.logger;
  }
}

// Default export
export default DevRevCoderAgent;
