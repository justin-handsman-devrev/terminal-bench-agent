import winston from 'winston';
import { LLMClient } from '../core/llm/client';
import { CommandExecutor } from '../core/execution/command-executor';
import { OrchestratorHub } from './actions/orchestrator-hub';
import { TodoManager, ScratchpadManager } from './actions/state-managers';
import { SimpleActionParser } from './actions/parsing/parser';
import { ActionHandler } from './actions/parsing/action-handler';
import { TurnExecutor } from './execution/turn-executor';
import { OrchestratorState, ConversationHistoryManager } from './state/orchestrator-state';
import { loadOrchestratorSystemMessage } from './system-messages/system-message-loader';
import { TurnLogger } from '../core/logging/logger';
import { LLMMessage, AgentConfig, Turn } from '../types';
import { TaskProfile, detectProfile, mergeProfile } from './config/task-profiles';

export interface OrchestratorConfig extends AgentConfig {
  systemMessagePath?: string;
  loggingDir?: string;
  taskProfile?: string | TaskProfile;
  profileOverrides?: Partial<TaskProfile>;
  enableSmartRetry?: boolean;
  maxRetryAttempts?: number;
  enableMetrics?: boolean;
  metricsDir?: string;
}

export interface TaskResult {
  completed: boolean;
  finishMessage?: string;
  turnsExecuted: number;
  maxTurnsReached: boolean;
}

export class OrchestratorAgent {
  private systemMessage: string;
  private orchestratorHub: OrchestratorHub;
  private conversationHistory: ConversationHistoryManager;
  private actionParser: SimpleActionParser;
  private actionHandler: ActionHandler;
  private executor: TurnExecutor;
  private state: OrchestratorState;
  private llmClient: LLMClient;
  private orchestratorMessages: LLMMessage[] = [];
  private turnLogger?: TurnLogger;
  private profile?: TaskProfile;

  constructor(private config: OrchestratorConfig = {}) {
    this.systemMessage = this.loadSystemMessage(config.systemMessagePath);

    const llmConfig = {
      ...config,
      maxTokens: config.maxTokens, 
    };
    this.llmClient = new LLMClient(llmConfig);

    this.orchestratorHub = new OrchestratorHub();
    this.conversationHistory = new ConversationHistoryManager();

    this.actionParser = new SimpleActionParser();
    this.actionHandler = new ActionHandler(
      {} as CommandExecutor,
      new TodoManager(),
      new ScratchpadManager(),
      this.orchestratorHub,
      config
    );

    this.executor = new TurnExecutor(this.actionParser, this.actionHandler);

    this.state = new OrchestratorState(this.orchestratorHub, this.conversationHistory);

    if (config.taskProfile) {
      this.loadProfile(config.taskProfile, config.profileOverrides);
    }

    winston.info(`OrchestratorAgent initialized with model=${config.model}, temperature=${config.temperature}`);
  }

private async loadProfile(profileOrName: string | TaskProfile, overrides?: Partial<TaskProfile>): Promise<void> {
  let profile: TaskProfile;

  if (typeof profileOrName === 'string') {
    profile = await detectProfile(profileOrName, this.llmClient);
    winston.info(`Loading task profile: ${profile.name}`);
  } else {
    profile = profileOrName;
    winston.info(`Loading custom task profile: ${profile.name}`);
  }

  if (overrides) {
    profile = mergeProfile(profile, overrides);
    winston.info(`Applied profile overrides`);
  }

  this.profile = profile;
  winston.info(`Profile loaded: ${profile.description}`);
}

  private loadSystemMessage(path?: string): string {
    if (path) {
      const fs = require('fs');
      return fs.readFileSync(path, 'utf-8');
    } else {
      return loadOrchestratorSystemMessage();
    }
  }

  setup(commandExecutor: CommandExecutor, loggingDir?: string): void {
    this.actionHandler = new ActionHandler(
      commandExecutor,
      new TodoManager(),
      new ScratchpadManager(),
      this.orchestratorHub,
      { ...this.config, loggingDir }
    );

    this.executor = new TurnExecutor(this.actionParser, this.actionHandler);

    if (loggingDir) {
      this.turnLogger = new TurnLogger(loggingDir, 'orchestrator');
    }
  }

  async executeTurn(instruction: string, turnNum: number): Promise<{
    done: boolean;
    finishMessage?: string;
    hasError: boolean;
    actionsExecuted: number;
    turn: Turn;
  }> {
    winston.info(`\n=== ORCHESTRATOR TURN ${turnNum} STARTING ===`);

    const userMessage = `## Current Task\n${instruction}\n\n${this.state.toPrompt()}`;

    winston.info('Getting LLM response...');
    const llmResponse = await this.getLLMResponse(userMessage);
    winston.info('LLM response received, executing actions...');

    const result = await this.executor.execute(llmResponse);
    winston.info(`Actions executed - Count: ${result.actionsExecuted.length}`);

    if (result.subagentTrajectories) {
      winston.info(`Received ${Object.keys(result.subagentTrajectories).length} subagent report(s)`);
      for (const [taskId, trajectory] of Object.entries(result.subagentTrajectories)) {
        winston.info(`   - Task ${taskId}: ${(trajectory as any).title || 'Unknown'}`);
      }
    } else {
      winston.info('No subagent reports in this turn');
    }

    const turn: Turn = {
      llmOutput: llmResponse,
      actionsExecuted: result.actionsExecuted.map(action => {
        if (typeof action === 'object' && action !== null) {
          try {
            return JSON.parse(JSON.stringify(action));
          } catch (e) {
            return { error: 'Could not serialize action', actionType: action.constructor?.name };
          }
        }
        return action;
      }),
      envResponses: result.envResponses,
      subagentTrajectories: result.subagentTrajectories,
    };

    this.conversationHistory.addTurn(turn);

    if (this.turnLogger) {
      const turnData = {
        instruction,
        userMessage,
        llmResponse,
        actionsExecuted: result.actionsExecuted.map(action => {
          if (typeof action === 'object' && action !== null) {
            try {
              return JSON.parse(JSON.stringify(action));
            } catch (e) {
              return { error: 'Could not serialize action', actionType: action.constructor?.name };
            }
          }
          return action;
        }),
        envResponses: result.envResponses,
        subagentTrajectories: result.subagentTrajectories,
        done: result.done,
        finishMessage: result.finishMessage,
        hasError: result.hasError,
        stateSnapshot: this.state.toDict(),
      };
      await this.turnLogger.logTurn(turnNum, turnData);
    }

    if (result.done) {
      this.state.done = true;
      this.state.finishMessage = result.finishMessage;
      winston.info(`🟡 ORCHESTRATOR: Task marked as DONE - ${result.finishMessage}`);
    } else {
      winston.info(`🟡 ORCHESTRATOR TURN ${turnNum} COMPLETE - Continuing...\n`);
    }

    return {
      done: result.done,
      finishMessage: result.finishMessage,
      hasError: result.hasError,
      actionsExecuted: result.actionsExecuted.length,
      turn,
    };
  }

  private async getLLMResponse(userMessage: string): Promise<string> {
    const messages: LLMMessage[] = [
      { role: 'system', content: this.systemMessage },
      { role: 'user', content: userMessage },
    ];

    if (this.orchestratorMessages.length === 0) {
      this.orchestratorMessages.push({ role: 'system', content: this.systemMessage });
    }
    this.orchestratorMessages.push({ role: 'user', content: userMessage });

    const response = await this.llmClient.getResponse(messages);
    const cleanedContent = this.stripMarkdownCodeBlocks(response.content);

    const validationResult = this.validateResponse(cleanedContent);
    if (!validationResult.isValid) {
      winston.warn(`Response validation failed: ${validationResult.error}`);
      const retryMessage = `[VALIDATION ERROR] ${validationResult.error}\n\nPlease complete your response with all XML tags properly closed and valid YAML content.`;
      this.orchestratorMessages.push({ role: 'assistant', content: cleanedContent });
      this.orchestratorMessages.push({ role: 'user', content: retryMessage });

      const retryResponse = await this.llmClient.getResponse([...messages,
        { role: 'assistant', content: cleanedContent },
        { role: 'user', content: retryMessage }
      ]);

      const cleanedRetryContent = this.stripMarkdownCodeBlocks(retryResponse.content);
      this.orchestratorMessages.push({ role: 'assistant', content: cleanedRetryContent });
      return cleanedRetryContent;
    }

    this.orchestratorMessages.push({ role: 'assistant', content: cleanedContent });

    return cleanedContent;
  }

  private validateResponse(response: string): { isValid: boolean; error?: string } {
    const truncationIndicators = [
      response.endsWith('...'),
      response.endsWith('..'),
      response.endsWith('|'),
      response.length > 15000, 
      /\s+$/.test(response) && response.trim().endsWith(':'), 
    ];
    
    if (truncationIndicators.some(indicator => indicator)) {
      const lastLines = response.trim().split('\n').slice(-3);
      const lastLine = lastLines[lastLines.length - 1];
      
      if (lastLine.match(/^\s*(oldString|newString|content|cmd|description):\s*$/)) {
        return {
          isValid: false,
          error: `Response appears to be truncated. The last line "${lastLine}" suggests incomplete content.`
        };
      }
    }
    
    const xmlTagPattern = /<(\w+)(?:\s+[^>]*)?>/g;
    const openTags: string[] = [];
    
    let match;
    while ((match = xmlTagPattern.exec(response)) !== null) {
      const tagName = match[1];
      openTags.push(tagName);
    }
    
    for (const tagName of openTags) {
      const closeTagRegex = new RegExp(`</${tagName}>`, 'g');
      const openCount = (response.match(new RegExp(`<${tagName}(?:\\s+[^>]*)?>`, 'g')) || []).length;
      const closeCount = (response.match(closeTagRegex) || []).length;
      
      if (openCount !== closeCount) {
        return { 
          isValid: false, 
          error: `Unclosed XML tag detected: <${tagName}>. Found ${openCount} opening tags but only ${closeCount} closing tags.` 
        };
      }
    }
    
    const actionTags = ['file', 'bash', 'task_create', 'search', 'todo', 'finish', 'add_context', 'launch_subagent', 'report'];
    for (const tagName of actionTags) {
      const tagContentRegex = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'g');
      let tagMatch;
      while ((tagMatch = tagContentRegex.exec(response)) !== null) {
        const content = tagMatch[1].trim();
        if (content.includes('action:') && !content.includes('String:')) {
          if (tagName === 'file' && content.includes('action: edit')) {
            if (!content.includes('newString:')) {
              return { 
                isValid: false, 
                error: `Incomplete <file> action: edit - missing required 'newString' field` 
              };
            }
          }
        }
      }
    }
    
    return { isValid: true };
  }

  private stripMarkdownCodeBlocks(content: string): string {
    const trimmed = content.trim();
    if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
      const lines = trimmed.split('\n');
      if (lines.length >= 3) {
        if (lines[0].trim().match(/^```(\w+)?$/)) {
          const contentLines = lines.slice(1, -1);
          return contentLines.join('\n');
        }
      }
    }

    let cleaned = content.replace(/^```\w*$/gm, '');
    cleaned = cleaned.replace(/^```$/gm, '');

    return cleaned.trim();
  }

  async run(instruction: string, maxTurnsOverride?: number): Promise<TaskResult> {
    if (!this.profile) {
      this.loadProfile(await detectProfile(instruction, this.llmClient));
    }

    const profile = this.profile!;
    winston.info(`Auto-detected profile based on task: ${profile.name}`);

    const maxTurns = maxTurnsOverride || profile.maxTurns;
    winston.info(`Starting task with max turns: ${maxTurns} (profile: ${profile.name})`);

    let turnsExecuted = 0;
    let consecutiveSyntaxErrors = 0;
    const maxConsecutiveSyntaxErrors = 3; // Circuit breaker threshold

    while (!this.state.done && turnsExecuted < maxTurns) {
      turnsExecuted += 1;
      winston.info(`\n=== ORCHESTRATOR MAIN LOOP - Turn ${turnsExecuted}/${maxTurns} ===`);

      try {
        const result = await this.executeTurn(instruction, turnsExecuted);

        // Check for repeated syntax errors (circuit breaker) - now multi-language
        const hasSyntaxError = result.turn.envResponses.some(response => 
          response.includes('IndentationError') || 
          response.includes('SyntaxError') || 
          response.includes('[SYNTAX ERROR]') ||
          response.includes('compilation failed') ||
          response.includes('cannot find symbol') ||
          response.includes('undeclared identifier') ||
          response.includes('borrow checker') ||
          response.includes('expected \';\'') ||
          response.includes('missing return type')
        );

        if (hasSyntaxError) {
          consecutiveSyntaxErrors++;
          winston.warn(`Syntax error detected (consecutive count: ${consecutiveSyntaxErrors})`);
          
          if (consecutiveSyntaxErrors >= maxConsecutiveSyntaxErrors) {
            winston.error(`CIRCUIT BREAKER: ${consecutiveSyntaxErrors} consecutive syntax errors detected. Stopping to prevent infinite loop.`);
            this.state.done = true;
            this.state.finishMessage = `Task stopped due to repeated syntax errors (${consecutiveSyntaxErrors} consecutive). Manual intervention required.`;
            break;
          }
        } else {
          consecutiveSyntaxErrors = 0; // Reset counter on successful turn
        }

        if (result.done) {
          winston.info(`Task completed: ${result.finishMessage}`);
          break;
        }

      } catch (error) {
        winston.error(`Error in turn ${turnsExecuted}: ${error}`);
      }
    }

    return {
      completed: this.state.done,
      finishMessage: this.state.finishMessage,
      turnsExecuted,
      maxTurnsReached: turnsExecuted >= maxTurns,
    };
  }

  getState(): OrchestratorState {
    return this.state;
  }

  getTokenUsage(): { input: number; output: number } {
    return {
      input: this.llmClient.countInputTokens(this.orchestratorMessages),
      output: this.llmClient.countOutputTokens(this.orchestratorMessages),
    };
  }

  getProfile(): TaskProfile | undefined {
    return this.profile;
  }

  /**
   * Get subagent configuration based on current profile
   */
  getSubagentConfig(agentType: 'explorer' | 'coder'): any {
    if (!this.profile) return {};
    
    return {
      maxTurns: agentType === 'explorer' 
        ? this.profile.subagentDefaults.explorerMaxTurns 
        : this.profile.subagentDefaults.coderMaxTurns,
      adaptiveTurns: this.profile.adaptiveTurnLimit,
    };
  }

  destroy(): void {
    if (this.actionHandler) {
      this.actionHandler.destroy();
    }
  }
}
