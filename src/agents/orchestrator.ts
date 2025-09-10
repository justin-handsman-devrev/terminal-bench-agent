import { Agent, AgentContext, AgentResult, Config, ConversationMessage } from '../types';
import { ToolRegistry } from '../tools';
import { OpenRouterClient } from '../core/llm-client';
import { ConsoleLogger } from '../core/logger';
import { RepositoryAnalyzer } from '../core/repository-analyzer';
import { CodingAgent, AnalysisAgent, PlanningAgent } from './coding-agent';

export class AgentOrchestrator {
  private agents: Map<string, Agent> = new Map();
  private toolRegistry: ToolRegistry;
  private llmClient: OpenRouterClient;
  private logger: ConsoleLogger;
  private repositoryAnalyzer: RepositoryAnalyzer;
  private config: Config;

  constructor(config: Config, toolRegistry: ToolRegistry, llmClient: OpenRouterClient, logger: ConsoleLogger) {
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.llmClient = llmClient;
    this.logger = logger;
    this.repositoryAnalyzer = new RepositoryAnalyzer(logger);
    
    this.initializeAgents();
  }

  private initializeAgents(): void {
    this.registerAgent(new CodingAgent(this.llmClient, this.logger));
    this.registerAgent(new AnalysisAgent(this.llmClient, this.logger));
    this.registerAgent(new PlanningAgent(this.llmClient, this.logger));
  }

  private registerAgent(agent: Agent): void {
    this.agents.set(agent.name, agent);
    this.logger.debug(`Registered agent: ${agent.name}`);
  }

  async executeRequest(
    request: string, 
    repositoryPath: string, 
    conversationHistory: ConversationMessage[] = []
  ): Promise<AgentResult> {
    try {
      this.logger.info('Starting request execution');
      this.logger.highlight(`Request: ${request}`);
      
      // Analyze repository context
      this.logger.info('Analyzing repository context...');
      const repositoryContext = await this.repositoryAnalyzer.analyzeRepository(repositoryPath);
      
      // Determine the best agent for this request
      const selectedAgent = await this.selectAgent(request, repositoryContext);
      this.logger.info(`Selected agent: ${selectedAgent.name}`);

      // Build agent context
      const agentContext: AgentContext = {
        request,
        repositoryPath,
        availableTools: this.toolRegistry.getAllTools(),
        conversation: conversationHistory,
        config: this.config
      };

      // Execute with the selected agent
      this.logger.separator();
      this.logger.highlight(`Executing with ${selectedAgent.name}`);
      
      const result = await selectedAgent.execute(agentContext);

      // After execution, print TODO list if exists
      try {
        const { TodoManager } = await import('../core/todo-manager');
        const tm = new TodoManager(repositoryPath);
        const todos = await tm.list();
        if (todos.length > 0) {
          this.logger.info('Current TODOs:');
          todos.forEach((t, i) => {
            this.logger.info(`  ${i + 1}. [${t.status}] ${t.title} (${t.id})`);
          });
        }
      } catch {}
      
      this.logger.separator();
      if (result.success) {
        this.logger.success(`Task completed successfully by ${selectedAgent.name}`);
        if (result.toolsUsed && result.toolsUsed.length > 0) {
          this.logger.info(`Tools used: ${result.toolsUsed.join(', ')}`);
        }
        if (result.nextActions && result.nextActions.length > 0) {
          this.logger.info('Suggested next actions:');
          result.nextActions.forEach((action, index) => {
            this.logger.info(`  ${index + 1}. ${action}`);
          });
        }
      } else {
        this.logger.error(`Task failed: ${result.message}`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(`Request execution failed: ${error.message}`);
      return {
        success: false,
        message: `Orchestrator execution failed: ${error.message}`,
        toolsUsed: [],
        nextActions: []
      };
    }
  }

  async executeWithMultipleAgents(
    request: string,
    repositoryPath: string,
    conversationHistory: ConversationMessage[] = []
  ): Promise<AgentResult[]> {
    try {
      this.logger.info('Starting multi-agent execution');
      
      // Start with planning agent to break down the task
      const planningAgent = this.agents.get('PlanningAgent')!;
      const planningContext: AgentContext = {
        request: `Create a detailed execution plan for: ${request}`,
        repositoryPath,
        availableTools: this.toolRegistry.getToolsByCategory('file').concat(
          this.toolRegistry.getToolsByCategory('git')
        ),
        conversation: conversationHistory,
        config: this.config
      };

      this.logger.highlight('Phase 1: Planning');
      const planResult = await planningAgent.execute(planningContext);
      
      if (!planResult.success) {
        return [planResult];
      }

      const results: AgentResult[] = [planResult];

      // If the plan suggests specific next actions, execute them with appropriate agents
      if (planResult.nextActions && planResult.nextActions.length > 0) {
        this.logger.highlight('Phase 2: Execution');
        
        for (const action of planResult.nextActions.slice(0, 3)) { // Limit to 3 actions
          const agentContext: AgentContext = {
            request: action,
            repositoryPath,
            availableTools: this.toolRegistry.getAllTools(),
            conversation: conversationHistory,
            config: this.config
          };

          // Select appropriate agent for this action
          const selectedAgent = await this.selectAgentForAction(action);
          this.logger.info(`Executing action with ${selectedAgent.name}: ${action}`);
          
          const actionResult = await selectedAgent.execute(agentContext);
          results.push(actionResult);

          // Update conversation history with this result
          conversationHistory.push({
            role: 'assistant',
            content: actionResult.message,
            timestamp: new Date(),
            metadata: { agent: selectedAgent.name, action }
          });
        }
      }

      return results;
    } catch (error: any) {
      this.logger.error(`Multi-agent execution failed: ${error.message}`);
      return [{
        success: false,
        message: `Multi-agent execution failed: ${error.message}`,
        toolsUsed: [],
        nextActions: []
      }];
    }
  }

  private async selectAgent(request: string, repositoryContext: any): Promise<Agent> {
    const requestLower = request.toLowerCase();
    
    // Simple rule-based agent selection (could be enhanced with LLM-based selection)
    if (requestLower.includes('plan') || requestLower.includes('strategy') || 
        requestLower.includes('roadmap') || requestLower.includes('approach')) {
      return this.agents.get('PlanningAgent')!;
    }
    
    if (requestLower.includes('analyze') || requestLower.includes('review') || 
        requestLower.includes('audit') || requestLower.includes('assess')) {
      return this.agents.get('AnalysisAgent')!;
    }
    
    // Default to coding agent for implementation tasks
    return this.agents.get('CodingAgent')!;
  }

  private async selectAgentForAction(action: string): Promise<Agent> {
    const actionLower = action.toLowerCase();
    
    if (actionLower.includes('analyze') || actionLower.includes('review') || 
        actionLower.includes('examine') || actionLower.includes('inspect')) {
      return this.agents.get('AnalysisAgent')!;
    }
    
    // Most actions will be implementation-focused
    return this.agents.get('CodingAgent')!;
  }

  getAvailableAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAgent(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  async getAgentRecommendation(request: string): Promise<{
    recommended: Agent;
    reasoning: string;
    alternatives: Agent[];
  }> {
    try {
      const agentDescriptions = Array.from(this.agents.values()).map(agent => ({
        name: agent.name,
        description: agent.description,
        capabilities: agent.capabilities
      }));

      const prompt = `Given this request: "${request}"

Available agents:
${JSON.stringify(agentDescriptions, null, 2)}

Please recommend the best agent and provide reasoning. Response should be JSON with:
{
  "recommended": "AgentName",
  "reasoning": "explanation",
  "alternatives": ["AlternateAgent1", "AlternateAgent2"]
}`;

      const messages = [{ role: 'user' as const, content: prompt }];
      const recommendation = await this.llmClient.generateStructuredResponse<{
        recommended: string;
        reasoning: string;
        alternatives: string[];
      }>(
        messages, 
        {
          type: 'object',
          properties: {
            recommended: { type: 'string' },
            reasoning: { type: 'string' },
            alternatives: { type: 'array', items: { type: 'string' } }
          }
        },
        'Agent recommendation based on request analysis'
      );

      const recommendedAgent = this.agents.get(recommendation.recommended);
      if (!recommendedAgent) {
        throw new Error(`Recommended agent ${recommendation.recommended} not found`);
      }

      const alternatives = recommendation.alternatives
        .map((name: string) => this.agents.get(name))
        .filter(Boolean) as Agent[];

      return {
        recommended: recommendedAgent,
        reasoning: recommendation.reasoning,
        alternatives
      };
    } catch (error: any) {
      this.logger.error(`Failed to get agent recommendation: ${error.message}`);
      
      // Fallback to rule-based selection
      const selected = await this.selectAgent(request, {});
      return {
        recommended: selected,
        reasoning: 'Fallback selection due to recommendation error',
        alternatives: Array.from(this.agents.values()).filter(a => a !== selected)
      };
    }
  }
}
