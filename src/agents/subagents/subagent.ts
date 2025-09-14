import winston from 'winston';
import { LLMClient } from '../../core/llm/client';
import { CommandExecutor } from '../../core/execution/command-executor';
import { SimpleActionParser } from '../actions/parsing/parser';
import { ActionHandler } from '../actions/parsing/action-handler';
import { TurnExecutor } from '../execution/turn-executor';
import { TodoManager, ScratchpadManager } from '../actions/state-managers';
import { loadExplorerSystemMessage, loadCoderSystemMessage } from '../system-messages/system-message-loader';
import { TurnLogger } from '../../core/logging/logger';
import { 
  AgentType, 
  LLMMessage, 
  SubagentReport, 
  ContextItem, 
  AgentConfig 
} from '../../types';
import { isReportAction, ReportAction } from '../actions/entities/actions';

export interface SubagentTask {
  agentType: AgentType;
  title: string;
  description: string;
  ctxStoreCtxts: Record<string, string>; 
  bootstrapCtxts: Array<{ path: string; content: string; reason: string }>;
}

export interface SubagentConfig extends AgentConfig {
  maxTurns?: number;
  loggingDir?: string;
  taskId?: string;
}

export class Subagent {
  private systemMessage: string;
  private actionParser: SimpleActionParser;
  private actionHandler: ActionHandler;
  private executorStateless: TurnExecutor;
  private llmClient: LLMClient;
  private report?: SubagentReport;
  private messages: LLMMessage[] = [];
  private turnLogger?: TurnLogger;

  constructor(
    private task: SubagentTask,
    private executor: CommandExecutor,
    private config: SubagentConfig = {}
  ) {
    const maxTurns = config.maxTurns || 20;

    this.llmClient = new LLMClient(config);

    this.actionParser = new SimpleActionParser();
    this.actionHandler = new ActionHandler(
      executor,
      new TodoManager(),
      new ScratchpadManager(),
      undefined,
      config
    );

    this.executorStateless = new TurnExecutor(this.actionParser, this.actionHandler);

    this.systemMessage = this.loadSystemMessage();

    if (config.loggingDir) {
      const prefix = config.taskId ? `subagent_${config.taskId}` : `subagent_${task.agentType}`;
      this.turnLogger = new TurnLogger(config.loggingDir, prefix);
    }
  }

  private loadSystemMessage(): string {
    if (this.task.agentType === AgentType.EXPLORER) {
      return loadExplorerSystemMessage();
    } else if (this.task.agentType === AgentType.CODER) {
      return loadCoderSystemMessage();
    } else {
      throw new Error(`Unknown agent type: ${this.task.agentType}`);
    }
  }

  private buildTaskPrompt(): string {
    const sections: string[] = [];

    sections.push(`# Task: ${this.task.title}\n`);
    sections.push(`${this.task.description}\n`);

    if (Object.keys(this.task.ctxStoreCtxts).length > 0) {
      sections.push('## Provided Context\n');
      for (const [ctxId, content] of Object.entries(this.task.ctxStoreCtxts)) {
        sections.push(`### Context: ${ctxId}\n`);
        sections.push(`${content}\n`);
      }
    }

    if (this.task.bootstrapCtxts.length > 0) {
      sections.push('## Relevant Files/Directories\n');
      for (const item of this.task.bootstrapCtxts) {
        sections.push(`- ${item.path}: ${item.reason}\n`);
      }
    }

    sections.push('\nBegin your investigation/implementation now.');

    return sections.join('\n');
  }

  private checkForReport(actions: any[]): SubagentReport | null {
    for (const action of actions) {
      if (isReportAction(action)) {
        const reportAction = action as ReportAction;
        const contexts: ContextItem[] = reportAction.contexts.map(ctx => ({
          id: ctx.id,
          content: ctx.content,
        }));

        return {
          contexts,
          comments: reportAction.comments,
          meta: {
            trajectory: [...this.messages],
            totalInputTokens: 0,
            totalOutputTokens: 0, 
          },
        };
      }
    }
    return null;
  }

  async run(): Promise<SubagentReport> {
    const maxTurns = this.config.maxTurns || 20;

    this.messages = [
      { role: 'system', content: this.systemMessage },
      { role: 'user', content: this.buildTaskPrompt() },
    ];

    for (let turnNum = 0; turnNum < maxTurns; turnNum++) {
      winston.debug(`Subagent ${this.task.agentType} executing turn ${turnNum + 1}`);

      try {
        const llmResponse = await this.llmClient.getResponse(this.messages);

        winston.debug(`--- Subagent Turn ${turnNum + 1} ---`);
        winston.debug(`LLM Response:\n${llmResponse.content}`);

        this.messages.push({ role: 'assistant', content: llmResponse.content });

        const result = await this.executorStateless.execute(llmResponse.content);

        const envResponse = result.envResponses.join('\n');
        this.messages.push({ role: 'user', content: envResponse });
        winston.debug(`Environment Response:\n${envResponse}`);

        if (result.hasError && envResponse.includes('[PARSE ERROR]')) {
          const hint = `\nHint: Use block scalars for multi-line edits (oldString: |, newString: |). After each edit, read back the file to verify.`;
          this.messages.push({ role: 'user', content: hint });
        }

        if (this.turnLogger) {
          const turnData = {
            taskType: this.task.agentType,
            taskTitle: this.task.title,
            llmResponse: llmResponse.content,
            actionsExecuted: result.actionsExecuted.map(action => String(action)),
            envResponses: result.envResponses,
            messagesCount: this.messages.length,
          };
          await this.turnLogger.logTurn(turnNum + 1, turnData);
        }

        const report = this.checkForReport(result.actionsExecuted);
        if (report) {
          winston.info(`\n🔵 SUBAGENT REPORT DETECTED - Turn ${turnNum + 1}`);
          winston.info(`   Agent Type: ${this.task.agentType}`);
          winston.info(`   Task Title: ${this.task.title}`);
          winston.info(`   Comments: ${report.comments.length > 200 ? report.comments.slice(0, 200) + '...' : report.comments}`);
          winston.info(`   Contexts returned: ${report.contexts.length}`);

          this.report = report;

          if (report.meta) {
            report.meta.numTurns = turnNum + 1;
            report.meta.totalInputTokens = this.llmClient.countInputTokens(this.messages);
            report.meta.totalOutputTokens = this.llmClient.countOutputTokens(this.messages);
          }

          winston.debug(`Subagent completed with report: ${report.comments}`);
          winston.debug(`Token usage - Input: ${report.meta?.totalInputTokens}, Output: ${report.meta?.totalOutputTokens}`);

          winston.info('🔵 SUBAGENT RETURNING REPORT TO ORCHESTRATOR\n');
          return report;
        }

      } catch (error) {
        winston.error(`Error in subagent turn ${turnNum + 1}: ${error}`);
        this.messages.push({ 
          role: 'user', 
          content: `Error occurred: ${error}. Please continue.` 
        });
      }
    }

    winston.warn('Subagent reached max turns without reporting - forcing report');

    if (this.turnLogger) {
      const turnData = {
        taskType: this.task.agentType,
        taskTitle: this.task.title,
        event: 'forcing_report',
        reason: 'max_turns_reached',
      };
      await this.turnLogger.logTurn(maxTurns + 1, turnData);
    }

    const forceReportMsg = `
⚠️ CRITICAL: MAXIMUM TURNS REACHED ⚠️
You have reached the maximum number of allowed turns.
You MUST now submit a report using ONLY the <report> action.
NO OTHER ACTIONS ARE ALLOWED.

Instructions:
1. Use ONLY the <report> action
2. Include ALL contexts you have discovered so far
3. In the comments section:
   - Summarize what you have accomplished
   - If the task is incomplete, explain what remains to be done
   - Describe what you were about to do next and why

SUBMIT YOUR REPORT NOW.`;

    if (this.messages.length > 0 && this.messages[this.messages.length - 1].role === 'user') {
      this.messages[this.messages.length - 1].content += forceReportMsg;
    } else {
      this.messages.push({ role: 'user', content: forceReportMsg.trim() });
    }

    try {
      const llmResponse = await this.llmClient.getResponse(this.messages);
      this.messages.push({ role: 'assistant', content: llmResponse.content });

      const result = await this.executorStateless.execute(llmResponse.content);

      const report = this.checkForReport(result.actionsExecuted);
      if (report) {
        winston.info(`\n🔵 SUBAGENT FORCED REPORT DETECTED - After ${maxTurns} turns`);
        winston.info(`   Agent Type: ${this.task.agentType}`);
        winston.info(`   Task Title: ${this.task.title}`);
        winston.info(`   Comments: ${report.comments.length > 200 ? report.comments.slice(0, 200) + '...' : report.comments}`);
        winston.info(`   Contexts returned: ${report.contexts.length}`);

        if (report.meta) {
          report.meta.numTurns = maxTurns + 1;
          report.meta.totalInputTokens = this.llmClient.countInputTokens(this.messages);
          report.meta.totalOutputTokens = this.llmClient.countOutputTokens(this.messages);
        }

        winston.debug(`Token usage - Input: ${report.meta?.totalInputTokens}, Output: ${report.meta?.totalOutputTokens}`);
        winston.info('🔵 SUBAGENT RETURNING FORCED REPORT TO ORCHESTRATOR\n');

        if (this.turnLogger) {
          const summaryData = {
            taskType: this.task.agentType,
            taskTitle: this.task.title,
            completed: true,
            numTurns: report.meta?.numTurns,
            totalInputTokens: report.meta?.totalInputTokens,
            totalOutputTokens: report.meta?.totalOutputTokens,
            contextsReturned: report.contexts.length,
            comments: report.comments,
          };
          await this.turnLogger.logFinalSummary(summaryData);
        }

        return report;
      }
    } catch (error) {
      winston.error(`Error forcing report: ${error}`);
    }

    winston.warn(`\n🔴 SUBAGENT FALLBACK - No report provided after ${maxTurns} turns`);
    winston.warn(`   Agent Type: ${this.task.agentType}`);
    winston.warn(`   Task Title: ${this.task.title}`);
    winston.warn('   Creating fallback report\n');

    return {
      contexts: [],
      comments: `Task incomplete - reached maximum turns (${maxTurns}) without proper completion. Agent failed to provide report when requested.`,
      meta: {
        trajectory: [...this.messages],
        numTurns: maxTurns,
        totalInputTokens: this.llmClient.countInputTokens(this.messages),
        totalOutputTokens: this.llmClient.countOutputTokens(this.messages),
      },
    };
  }
}
