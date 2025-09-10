import axios, { AxiosInstance } from 'axios';
import { Config, LLMMessage, LLMResponse, ToolCall } from '../types';
import { ConsoleLogger } from './logger';

export class OpenRouterClient {
  private client: AxiosInstance;
  private config: Config;
  private logger: ConsoleLogger;

  constructor(config: Config, logger: ConsoleLogger) {
    this.config = config;
    this.logger = logger;
    
    if (!config.openRouter.apiKey) {
      throw new Error('OPENROUTER_API_KEY is required. Please set it in your .env file or environment variables.');
    }
    
    this.client = axios.create({
      baseURL: config.openRouter.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.openRouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/devrev/coder-agent',
        'X-Title': 'DevRev Coder Agent'
      }
    });
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      this.logger.debug(`Sending ${messages.length} messages to LLM`);
      
      const response = await this.client.post('/chat/completions', {
        model: this.config.openRouter.model,
        messages,
        temperature: this.config.agent.temperature,
        max_tokens: 4000,
        stream: false
      });

      const result = response.data;
      const content = result.choices?.[0]?.message?.content || '';
      
      this.logger.debug('Received LLM response', {
        model: result.model,
        usage: result.usage
      });

      return {
        content,
        usage: result.usage ? {
          promptTokens: result.usage.prompt_tokens,
          completionTokens: result.usage.completion_tokens,
          totalTokens: result.usage.total_tokens
        } : undefined
      };
    } catch (error: any) {
      this.logger.error('LLM request failed:', error.message);
      throw new Error(`LLM request failed: ${error.message}`);
    }
  }

  async chatWithTools(messages: LLMMessage[], tools: any[]): Promise<{
    response: LLMResponse;
    toolCalls?: ToolCall[];
  }> {
    try {
      this.logger.debug(`Sending ${messages.length} messages with ${tools.length} tools`);
      
      const response = await this.client.post('/chat/completions', {
        model: this.config.openRouter.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: this.config.agent.temperature,
        max_tokens: 4000,
        stream: false
      });

      const result = response.data;
      const choice = result.choices?.[0];
      const message = choice?.message;
      
      const llmResponse: LLMResponse = {
        content: message?.content || '',
        usage: result.usage ? {
          promptTokens: result.usage.prompt_tokens,
          completionTokens: result.usage.completion_tokens,
          totalTokens: result.usage.total_tokens
        } : undefined
      };

      let toolCalls: ToolCall[] | undefined;
      if (message?.tool_calls) {
        toolCalls = message.tool_calls.map((call: any) => ({
          name: call.function.name,
          parameters: JSON.parse(call.function.arguments)
        }));
      }

      this.logger.debug('Received LLM response with tools', {
        model: result.model,
        usage: result.usage,
        toolCallsCount: toolCalls?.length || 0
      });

      return { response: llmResponse, toolCalls };
    } catch (error: any) {
      this.logger.error('LLM request with tools failed:', error.message);
      throw new Error(`LLM request with tools failed: ${error.message}`);
    }
  }

  async generateStructuredResponse<T>(
    messages: LLMMessage[], 
    schema: any,
    description: string
  ): Promise<T> {
    try {
      const structuredPrompt = `Please respond with a JSON object that matches this schema:
${JSON.stringify(schema, null, 2)}

Description: ${description}

Respond only with valid JSON matching this schema.`;

      const structuredMessages = [
        ...messages,
        { role: 'system' as const, content: structuredPrompt }
      ];

      const response = await this.chat(structuredMessages);
      
      // Try to parse JSON from response
      const jsonMatch = response.content.match(/```json\n([\s\S]*?)\n```/) ||
                        response.content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      
      this.logger.debug('Generated structured response', { schema: typeof parsed });
      return parsed;
    } catch (error: any) {
      this.logger.error('Failed to generate structured response:', error.message);
      throw new Error(`Failed to generate structured response: ${error.message}`);
    }
  }
}
