import OpenAI from 'openai';
import { LLMMessage, LLMResponse, AgentConfig, OpenRouterProviderConfig } from '../../types';

export interface LLMClientConfig extends AgentConfig {
  maxRetries?: number;
  siteUrl?: string;
  siteName?: string;
  provider?: OpenRouterProviderConfig;
}

export class LLMClient {
  private client: OpenAI;
  private config: LLMClientConfig;
  private baseURL: string | undefined;

  constructor(config: LLMClientConfig) {
    this.config = {
      maxRetries: 10,
      temperature: process.env.OPENROUTER_TEMPERATURE ? parseFloat(process.env.OPENROUTER_TEMPERATURE) : 0.3,
      ...config,
      provider: { ...this.parseProviderFromEnv(), ...config.provider },
    };

    const apiKey = this.config.apiKey || process.env.OPENROUTER_API_KEY;
    this.baseURL = this.config.apiBase || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

    if (!apiKey) {
      throw new Error('No API key provided. Set OPENROUTER_API_KEY environment variable or provide apiKey in config.');
    }

    const defaultHeaders: Record<string, string> = {};
    
    if (this.config.siteUrl) {
      defaultHeaders['HTTP-Referer'] = this.config.siteUrl;
    }
    if (this.config.siteName) {
      defaultHeaders['X-Title'] = this.config.siteName;
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: this.baseURL,
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
    });
  }

  async getResponse(messages: LLMMessage[]): Promise<LLMResponse> {
    const maxRetries = this.config.maxRetries || 10;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const processedMessages = this.applyCachingIfPossible(messages).map(msg => {
          let apiContent = typeof msg.content === 'string' 
            ? [{ type: 'text', text: msg.content }] 
            : msg.content;

          if (typeof msg.content === 'string') {
            // Parse for image data URIs in text
            const imageMatch = msg.content.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,([A-Za-z0-9+/=]+)/g);
            if (imageMatch) {
              // Extract the first image URI (support multiple if needed)
              const uriMatch = imageMatch[0].match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,([A-Za-z0-9+/=]+)/);
              if (uriMatch) {
                const mimeType = uriMatch[1];
                const base64Data = uriMatch[2];
                const imageUrl = `data:${mimeType};base64,${base64Data}`;
                const textContent = msg.content.replace(/\[?data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,[A-Za-z0-9+/=]+\]?/g, '[IMAGE]').replace(/\s+/g, ' '); // Simplified cleanup
                apiContent = [
                  { type: 'text', text: textContent },
                  { type: 'image_url', image_url: { url: imageUrl } }
                ];
              }
            }
          }

          return {
            role: msg.role,
            content: apiContent,
          };
        });
        
        let { model, providerOverrides } = this.parseModelString(this.config.model || process.env.OPENROUTER_MODEL || '');

        // Check for vision messages and ensure vision-capable model
        const hasImage = processedMessages.some(pm => 
          Array.isArray(pm.content) && 
          pm.content.some(part => part.type === 'image_url')
        );
        if (hasImage && !model.includes('gpt-4') && !model.includes('gpt-4o') && !model.includes('vision')) {
          model = 'openai/gpt-4o'; // Default to a vision-capable model via OpenRouter
          console.warn('Vision content detected, switching to vision-capable model: openai/gpt-4o');
        }

        const requestBody: any = {
          model,
          messages: processedMessages.map(msg => ({
            role: msg.role,
            content: msg.content,
          })),
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
        };

        const providerConfig = { ...providerOverrides, ...this.config.provider };
        if (Object.keys(providerConfig).length > 0) {
          requestBody.provider = providerConfig;
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

  private parseProviderFromEnv(): Partial<OpenRouterProviderConfig> {
    const providerConfig: Partial<OpenRouterProviderConfig> = {};

    if (process.env.OPENROUTER_PROVIDER_ORDER) {
      providerConfig.order = process.env.OPENROUTER_PROVIDER_ORDER.split(',').map(p => p.trim());
    }

    if (process.env.OPENROUTER_ALLOW_FALLBACKS) {
      providerConfig.allow_fallbacks = process.env.OPENROUTER_ALLOW_FALLBACKS.toLowerCase() === 'true';
    }

    if (process.env.OPENROUTER_DATA_COLLECTION) {
      const policy = process.env.OPENROUTER_DATA_COLLECTION.toLowerCase();
      if (policy === 'allow' || policy === 'deny') {
        providerConfig.data_collection = policy as 'allow' | 'deny';
      }
    }

    if (process.env.OPENROUTER_PROVIDER_SORT) {
      const sort = process.env.OPENROUTER_PROVIDER_SORT.toLowerCase();
      if (sort === 'price' || sort === 'throughput' || sort === 'latency') {
        providerConfig.sort = sort as 'price' | 'throughput' | 'latency';
      }
    }

    if (process.env.OPENROUTER_PROVIDER_ONLY) {
      providerConfig.only = process.env.OPENROUTER_PROVIDER_ONLY.split(',').map(p => p.trim());
    }

    if (process.env.OPENROUTER_PROVIDER_IGNORE) {
      providerConfig.ignore = process.env.OPENROUTER_PROVIDER_IGNORE.split(',').map(p => p.trim());
    }

    if (process.env.OPENROUTER_REQUIRE_PARAMETERS) {
      providerConfig.require_parameters = process.env.OPENROUTER_REQUIRE_PARAMETERS.toLowerCase() === 'true';
    }

    return providerConfig;
  }

  private parseModelString(modelString: string): { model: string; providerOverrides: Partial<OpenRouterProviderConfig> } {
    const providerOverrides: Partial<OpenRouterProviderConfig> = {};
    
    if (modelString.endsWith(':nitro')) {
      providerOverrides.sort = 'throughput';
      return {
        model: modelString.replace(':nitro', ''),
        providerOverrides
      };
    }
       
    if (modelString.endsWith(':floor')) {
      providerOverrides.sort = 'price';
      return {
        model: modelString.replace(':floor', ''),
        providerOverrides
      };
    }
      
    return {
      model: modelString,
      providerOverrides
    };
  }

  countTokens(messages: LLMMessage[]): number {
    let totalChars = 0;
    messages.forEach(msg => {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        msg.content.forEach(part => {
          if (part.type === 'text' && typeof part.text === 'string') {
            totalChars += part.text.length;
          }
          // Approximate: ignore images or add fixed cost if needed
        });
      }
    });
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
