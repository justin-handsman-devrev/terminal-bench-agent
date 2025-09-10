import { nanoid } from 'nanoid';
import { Agent, AgentContext, AgentResult, Tool, ToolCall, LLMMessage } from '../types';
import { OpenRouterClient } from '../core/llm-client';
import { ConsoleLogger } from '../core/logger';

export abstract class BaseAgent implements Agent {
  public readonly id: string;
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly capabilities: string[];

  protected llmClient: OpenRouterClient;
  protected logger: ConsoleLogger;

  constructor(llmClient: OpenRouterClient, logger: ConsoleLogger) {
    this.id = nanoid();
    this.llmClient = llmClient;
    this.logger = logger;
  }

  abstract execute(context: AgentContext): Promise<AgentResult>;

  protected async callLLM(
    messages: LLMMessage[], 
    tools?: Tool[]
  ): Promise<{ response: string; toolCalls?: ToolCall[] }> {
    try {
      if (tools && tools.length > 0) {
        const toolSpecs = tools.map(tool => {
          if ('toOpenAIToolSpec' in tool && typeof tool.toOpenAIToolSpec === 'function') {
            return (tool as any).toOpenAIToolSpec();
          }
          return this.createToolSpec(tool);
        });

        const result = await this.llmClient.chatWithTools(messages, toolSpecs);
        return {
          response: result.response.content,
          toolCalls: result.toolCalls
        };
      } else {
        const result = await this.llmClient.chat(messages);
        return { response: result.content };
      }
    } catch (error: any) {
      this.logger.error(`LLM call failed: ${error.message}`);
      throw error;
    }
  }

  protected async executeTools(
    toolCalls: ToolCall[], 
    availableTools: Tool[], 
    context: AgentContext
  ): Promise<{ results: any[]; messages: LLMMessage[] }> {
    const results: any[] = [];
    const messages: LLMMessage[] = [];

    for (const toolCall of toolCalls) {
      const tool = availableTools.find(t => t.name === toolCall.name);
      
      if (!tool) {
        const error = `Tool not found: ${toolCall.name}`;
        this.logger.error(error);
        results.push({ success: false, error });
        messages.push({
          role: 'system',
          content: `Error: ${error}`
        });
        continue;
      }

      try {
        this.logger.info(`Executing tool: ${tool.name}`);
        
        const toolContext = {
          repositoryPath: context.repositoryPath,
          config: context.config,
          logger: this.logger
        };

        const result = await tool.execute(toolCall.parameters, toolContext);
        results.push(result);

        // Include structured tool result back into the conversation so LLM can act on it
        messages.push({
          role: 'system',
          content: `TOOL_RESULT ${tool.name}: ${JSON.stringify({ success: result.success, message: result.message, error: result.error, data: result.data }, null, 2)}`
        });

        if (result.success) {
          this.logger.info(`Tool ${tool.name} completed successfully`);
        } else {
          this.logger.warn(`Tool ${tool.name} failed: ${result.error}`);
        }
      } catch (error: any) {
        const errorMsg = `Tool execution error: ${error.message}`;
        this.logger.error(errorMsg);
        results.push({ success: false, error: errorMsg });
        messages.push({
          role: 'system',
          content: errorMsg
        });
      }
    }

    return { results, messages };
  }

  protected createSuccessResult(
    message: string, 
    data?: any, 
    toolsUsed?: string[], 
    nextActions?: string[]
  ): AgentResult {
    return {
      success: true,
      message,
      data,
      toolsUsed: toolsUsed || [],
      nextActions: nextActions || []
    };
  }

  protected createErrorResult(message: string, data?: any): AgentResult {
    return {
      success: false,
      message,
      data,
      toolsUsed: [],
      nextActions: []
    };
  }

  private createToolSpec(tool: Tool): any {
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
  }

  protected buildSystemPrompt(): string {
    return `You are ${this.name}, ${this.description}
    
Your capabilities include:
${this.capabilities.map(cap => `- ${cap}`).join('\n')}

Guidelines:
- Always analyze the request thoroughly before taking action
- Use the available tools to gather information and make changes
- Provide clear explanations of what you're doing and why
- If you encounter errors, try alternative approaches
- Always verify your changes when possible
- Be proactive in suggesting improvements and next steps

When using tools:
- Choose the most appropriate tool for each task
- Provide clear and specific parameters
- Handle errors gracefully and explain what went wrong
- Use multiple tools in sequence when needed to complete complex tasks`;
  }
}
