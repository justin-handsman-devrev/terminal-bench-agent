import OpenAI from 'openai';
import { LLMMessage, LLMResponse, AgentConfig } from '../../types';

export interface LLMClientConfig extends AgentConfig {
  maxRetries?: number;
  provider?: {
    order?: string[];
    allow_fallbacks?: boolean;
  };
  siteUrl?: string;
  siteName?: string;
}

export class LLMClient {
  private client: OpenAI;
  private config: LLMClientConfig;

  constructor(config: LLMClientConfig) {
    this.config = {
      maxRetries: 10,
      maxTokens: 4096,
      temperature: 0.7,
      ...config,
    };

    const apiKey = this.config.apiKey || 
                   process.env.OPENROUTER_API_KEY || 
                   process.env.LITE_LLM_API_KEY || 
                   process.env.OPENAI_API_KEY;

    const baseURL = this.config.apiBase || 
                    process.env.OPENROUTER_BASE_URL || 
                    process.env.LITE_LLM_API_BASE || 
                    process.env.OPENAI_BASE_URL || 
                    (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined);
                    

    if (!apiKey) {
      throw new Error(
        'No API key provided. Set one of: OPENROUTER_API_KEY, LITE_LLM_API_KEY, or OPENAI_API_KEY'
      );
    }

    const defaultHeaders: Record<string, string> = {};
    
    if (baseURL?.includes('openrouter.ai')) {
      if (this.config.siteUrl) {
        defaultHeaders['HTTP-Referer'] = this.config.siteUrl;
      }
      if (this.config.siteName) {
        defaultHeaders['X-Title'] = this.config.siteName;
      }
    }

    this.client = new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
    });
  }

  async getResponse(messages: LLMMessage[]): Promise<LLMResponse> {
    const maxRetries = this.config.maxRetries || 10;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const processedMessages = this.applyCachingIfPossible(messages);
        
        const requestBody: any = {
          model: this.config.model || 
                 process.env.LITELLM_MODEL || 
                 process.env.OPENROUTER_MODEL,
          messages: processedMessages.map(msg => ({
            role: msg.role,
            content: msg.content,
          })),
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
        };

        if (this.config.provider || (process.env.LITELLM_PROVIDER && process.env.LITELLM_PROVIDER.length > 0)) {
          requestBody.provider = this.config.provider || {
            order: process.env.LITELLM_PROVIDER?.split(','),
            allow_fallbacks: true,
          };
        }

        const response = await this.client.chat.completions.create(requestBody);

        const content = response.choices[0]?.message?.content || '';
        const usage = response.usage ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
        } : undefined;

        return { content, usage };

      } catch (error: any) {
        if (error.status === 429 || error.message?.includes('overloaded')) {
          if (attempt < maxRetries - 1) {
            const baseDelay = Math.pow(2, attempt);
            const jitter = Math.random() * baseDelay * 0.1;
            const delay = Math.min(baseDelay + jitter, 60); 
            
            console.log(`Rate limited, retrying in ${delay.toFixed(2)} seconds (attempt ${attempt + 1}/${maxRetries})`);
            await this.sleep(delay * 1000);
            continue;
          }
        }
        
        throw error;
      }
    }

    throw new Error('Failed to get LLM response after maximum retries');
  }

  private applyCachingIfPossible(messages: LLMMessage[]): LLMMessage[] {
    return messages;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  countTokens(messages: LLMMessage[]): number {
    const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    return Math.ceil(totalChars / 4);
  }

  countInputTokens(messages: LLMMessage[]): number {
    const inputMessages = messages.filter(msg => msg.role === 'system' || msg.role === 'user');
    return this.countTokens(inputMessages);
  }

  countOutputTokens(messages: LLMMessage[]): number {
    const outputMessages = messages.filter(msg => msg.role === 'assistant');
    return this.countTokens(outputMessages);
  }
}
