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

export interface OrchestratorConfig extends AgentConfig {
  systemMessagePath?: string;
  loggingDir?: string;
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

  constructor(private config: OrchestratorConfig = {}) {
    this.systemMessage = this.loadSystemMessage(config.systemMessagePath);

    this.llmClient = new LLMClient(config);

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

    winston.info(`OrchestratorAgent initialized with model=${config.model}, temperature=${config.temperature}`);
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

    this.orchestratorMessages.push({ role: 'assistant', content: response.content });

    return response.content;
  }

  async run(instruction: string, maxTurns: number = 50): Promise<TaskResult> {
    let turnsExecuted = 0;

    while (!this.state.done && turnsExecuted < maxTurns) {
      turnsExecuted += 1;
      winston.info(`\n=== ORCHESTRATOR MAIN LOOP - Turn ${turnsExecuted}/${maxTurns} ===`);

      try {
        const result = await this.executeTurn(instruction, turnsExecuted);

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
}
