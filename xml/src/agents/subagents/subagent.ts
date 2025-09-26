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
  adaptiveTurns?: boolean;
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
    // Set default turn limits based on agent type
    const defaultTurns = this.getDefaultTurnsForAgentType(task.agentType);
    const maxTurns = config.maxTurns || defaultTurns;

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

  private getDefaultTurnsForAgentType(agentType: AgentType): number {
    switch (agentType) {
      case AgentType.EXPLORER:
        return 15; // Explorers often need more turns for thorough investigation
      case AgentType.CODER:
        return 30; // Coders need many iterations for complex implementations
      default:
        return 20; // Fallback default
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

  private checkNeedsExtension(): boolean {
    // Check the last few messages to see if the agent is making progress
    const recentMessages = this.messages.slice(-6); // Last 3 exchanges

    // Indicators that suggest the agent needs more time
    const progressIndicators = [
      'almost done', 'nearly complete', 'one more', 'final step',
      'just need to', 'finishing up', 'last thing',
      'wrapping up', 'about to complete', 'close to finishing'
    ];

    const frustrationIndicators = [
      'max turns', 'running out of turns', 'not enough turns',
      'need more time', 'almost out of turns'
    ];

    const recentContent = recentMessages
      .map(msg => typeof msg.content === 'string' ? msg.content.toLowerCase() : '')
      .join(' ');

    // Check for progress indicators
    const showsProgress = progressIndicators.some(indicator =>
      recentContent.includes(indicator)
    );

    // Check for frustration about turn limits
    const showsFrustration = frustrationIndicators.some(indicator =>
      recentContent.includes(indicator)
    );

    // Check if actively working (has recent file operations)
    const hasRecentFileOps = recentContent.includes('file>') ||
                            recentContent.includes('edit>') ||
                            recentContent.includes('write>');

    // Grant extension if showing progress or frustration and actively working
    return (showsProgress || showsFrustration) && hasRecentFileOps;
  }

  private stripMarkdownCodeBlocks(content: string): string {
    // Remove markdown code block markers like ```xml or ```yaml
    // Handle the most common case: entire response is a code block
    const trimmed = content.trim();
    if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
      const lines = trimmed.split('\n');
      if (lines.length >= 3) {
        // Check if first line is a code block marker (``` optionally followed by language)
        if (lines[0].trim().match(/^```(\w+)?$/)) {
          // Remove first line (```language) and last line (```)
          const contentLines = lines.slice(1, -1);
          return contentLines.join('\n');
        }
      }
    }

    // Handle embedded code blocks or partial markers
    // Remove opening markers at start of lines
    let cleaned = content.replace(/^```\w*$/gm, '');
    // Remove closing markers at end of lines
    cleaned = cleaned.replace(/^```$/gm, '');

    return cleaned.trim();
  }

  async run(): Promise<SubagentReport> {
    const defaultTurns = this.getDefaultTurnsForAgentType(this.task.agentType);
    let maxTurns = this.config.maxTurns || defaultTurns;
    const adaptiveTurns = this.config.adaptiveTurns ?? true; // Default to true
    let turnExtensions = 0;
    const maxExtensions = 2; // Allow up to 2 extensions of 5 turns each

    this.messages = [
      { role: 'system', content: this.systemMessage },
      { role: 'user', content: this.buildTaskPrompt() },
    ];

    let consecutiveSyntaxErrors = 0;
    const maxConsecutiveSyntaxErrors = 3; // Circuit breaker for subagents too

    for (let turnNum = 0; turnNum < maxTurns; turnNum++) {
      winston.debug(`Subagent ${this.task.agentType} executing turn ${turnNum + 1}`);

      try {
        const llmResponse = await this.llmClient.getResponse(this.messages);

        // Strip markdown code blocks if present
        const cleanedContent = this.stripMarkdownCodeBlocks(llmResponse.content);

        winston.debug(`--- Subagent Turn ${turnNum + 1} ---`);
        winston.debug(`LLM Response:\n${cleanedContent}`);

        this.messages.push({ role: 'assistant', content: cleanedContent });

        const result = await this.executorStateless.execute(cleanedContent);

        const envResponse = result.envResponses.join('\n');
        this.messages.push({ role: 'user', content: envResponse });
        winston.debug(`Environment Response:\n${envResponse}`);

        // Check for syntax errors (circuit breaker) - now multi-language
        const hasSyntaxError = envResponse.includes('IndentationError') || 
                             envResponse.includes('SyntaxError') || 
                             envResponse.includes('[SYNTAX ERROR]') ||
                             envResponse.includes('compilation failed') ||
                             envResponse.includes('cannot find symbol') ||
                             envResponse.includes('undeclared identifier') ||
                             envResponse.includes('borrow checker') ||
                             envResponse.includes('expected \';\'') ||
                             envResponse.includes('missing return type');

        if (hasSyntaxError) {
          consecutiveSyntaxErrors++;
          winston.warn(`Subagent syntax error detected (consecutive count: ${consecutiveSyntaxErrors})`);
          
          if (consecutiveSyntaxErrors >= maxConsecutiveSyntaxErrors) {
            winston.error(`SUBAGENT CIRCUIT BREAKER: ${consecutiveSyntaxErrors} consecutive syntax errors. Forcing early termination.`);
            const errorReport: SubagentReport = {
              contexts: [],
              comments: `Task terminated due to repeated syntax errors (${consecutiveSyntaxErrors} consecutive). The agent was unable to generate valid code and got stuck in an error loop. Manual code review and fixes are required.`,
              meta: {
                trajectory: [...this.messages],
                numTurns: turnNum + 1,
                totalInputTokens: this.llmClient.countInputTokens(this.messages),
                totalOutputTokens: this.llmClient.countOutputTokens(this.messages)
              }
            };
            return errorReport;
          }
        } else {
          consecutiveSyntaxErrors = 0; // Reset on successful turn
        }

        if (result.hasError && envResponse.includes('[PARSE ERROR]')) {
          const hint = `\nHint: Use only supported tags. File ops: <file> with action: read|write|edit|multi_edit|metadata. Search: <search> with action: grep|glob|ls. Do not use <read>/<grep> tags. Use block scalars for multi-line edits (oldString: |, newString: |). Always read back after edits.`;
          this.messages.push({ role: 'user', content: hint });
        }

        if (this.turnLogger) {
          const turnData = {
            taskType: this.task.agentType,
            taskTitle: this.task.title,
            llmResponse: llmResponse.content,
            actionsExecuted: result.actionsExecuted.map(action => {
              if (typeof action === 'object' && action !== null) {
                try {
                  return JSON.stringify(action, null, 2);
                } catch (e) {
                  return `{ "error": "Could not serialize action", "actionType": "${action.constructor?.name}" }`;
                }
              }
              return action;
            }),
            envResponses: result.envResponses,
            messagesCount: this.messages.length,
          };
          await this.turnLogger.logTurn(turnNum + 1, turnData);
        }

        const report = this.checkForReport(result.actionsExecuted);
        if (report) {
          // Guard: do not accept report if the last turn had errors
          if (result.hasError) {
            const guidance = `\nReport received but errors were detected in the last turn. Do not report/finish yet.\nNext: fix errors, verify by re-reading affected files, ensure no error strings in environment output, then report.`;
            this.messages.push({ role: 'user', content: guidance });
            continue;
          }

          // Guard: check for build validation if code changes were made
          if (this.actionHandler.hasCodeChanges()) {
            winston.info('Code changes detected in subagent, running build/test validation...');
            const [validationOutput, hasCriticalError] = await this.actionHandler.runBuildValidation();
            this.messages.push({ role: 'user', content: `Build/Test Validation Results:\n${validationOutput}` });
            
            if (hasCriticalError) {
              const guidance = `\nReport received but CRITICAL build errors found (syntax errors, missing imports, compilation failures). Do not report yet.\nNext: fix these critical errors, verify by re-running validation, then report.`;
              this.messages.push({ role: 'user', content: guidance });
              continue;
            }
            
            if (validationOutput.includes('[WARNING]')) {
              winston.info('Build validation passed with warnings for subagent - proceeding');
            } else {
              winston.info('Build/test validation passed for subagent');
            }
            this.actionHandler.clearCodeChangeTracking();
          }
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

      // Check if we need adaptive turn extension
      if (adaptiveTurns && turnNum === maxTurns - 1 && turnExtensions < maxExtensions) {
        const needsExtension = this.checkNeedsExtension();
        if (needsExtension) {
          turnExtensions++;
          maxTurns += 5;
          winston.info(`Extending turns by 5 (extension ${turnExtensions}/${maxExtensions}). New max: ${maxTurns}`);
          const extensionMsg = `[TURN EXTENSION] You've been granted 5 additional turns to complete your task. Current progress suggests you're close to completion. Focus on finishing the essential parts.`;
          this.messages.push({ role: 'user', content: extensionMsg });
        }
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

      // Strip markdown code blocks if present
      const cleanedContent = this.stripMarkdownCodeBlocks(llmResponse.content);
      this.messages.push({ role: 'assistant', content: cleanedContent });

      const result = await this.executorStateless.execute(cleanedContent);

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
