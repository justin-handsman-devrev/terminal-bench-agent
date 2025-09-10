import { Config, ConfigSchema } from '../types';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

export class ConfigManager {
  private static instance: ConfigManager;
  private config!: Config;

  private constructor() {
    this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): void {
    // Try to load .env file if it exists
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }

    // Build config from environment variables with defaults
    const configData = {
      openRouter: {
        apiKey: process.env.OPENROUTER_API_KEY || '',
        model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-experimental',
        baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
      },
      agent: {
        maxConcurrentAgents: parseInt(process.env.MAX_CONCURRENT_AGENTS || '3'),
        maxContextLength: parseInt(process.env.MAX_CONTEXT_LENGTH || '100000'),
        temperature: parseFloat(process.env.TEMPERATURE || '0.1')
      },
      tools: {
        maxFileSizeKB: parseInt(process.env.MAX_FILE_SIZE_KB || '500'),
        enableGitOperations: process.env.ENABLE_GIT_OPERATIONS !== 'false',
        enableFileOperations: process.env.ENABLE_FILE_OPERATIONS !== 'false'
      },
      logging: {
        level: (process.env.LOG_LEVEL as any) || 'info',
        logToFile: process.env.LOG_TO_FILE === 'true'
      }
    };

    // Validate and parse config
    const result = ConfigSchema.safeParse(configData);
    if (!result.success) {
      console.error('Invalid configuration:', result.error.format());
      process.exit(1);
    }

    this.config = result.data;
  }

  public getConfig(): Config {
    return this.config;
  }

  public updateConfig(updates: Partial<Config>): void {
    this.config = { ...this.config, ...updates };
  }

  public createEnvTemplate(): string {
    return `# DevRev Coder Agent Configuration

# OpenRouter Configuration (Required)
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=google/gemini-2.0-flash-experimental
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Agent Configuration
MAX_CONCURRENT_AGENTS=3
MAX_CONTEXT_LENGTH=100000
TEMPERATURE=0.1

# Tool Configuration
MAX_FILE_SIZE_KB=500
ENABLE_GIT_OPERATIONS=true
ENABLE_FILE_OPERATIONS=true

# Logging
LOG_LEVEL=info
LOG_TO_FILE=false`;
  }
}
