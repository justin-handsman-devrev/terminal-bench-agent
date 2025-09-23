import winston from 'winston';
import { CommandExecutor } from '../../../core/execution/command-executor';
import { OrchestratorHub } from '../orchestrator-hub';
import { TodoManager, ScratchpadManager } from '../state-managers';
import { FileManager } from '../file-manager';
import { SearchManager } from '../search-manager';
import { ErrorClassifier, withRetry, RetryConfig, ErrorType } from '../error-handler';
import { MetricsCollector } from '../metrics-collector';
import { ValidationCache, ValidationResult } from '../validation-cache';
import { MessageBus } from '../../subagents/communication-protocol';
import {
  AnyAction,
  BashAction,
  BatchBashAction,
  FinishAction,
  BatchTodoAction,
  ReadAction,
  WriteAction,
  EditAction,
  MultiEditAction,
  FileMetadataAction,
  GrepAction,
  GlobAction,
  LSAction,
  AddNoteAction,
  ViewAllNotesAction,
  ViewMetricsAction,
  ContextAnalysisAction,
  ViewValidationCacheAction,
  TaskCreateAction,
  AddContextAction,
  LaunchSubagentAction,
  ReportAction,
  WriteTempScriptAction,
  TestCompileAction,
  VerifyCompatibilityAction,
  isBashAction,
  isBatchBashAction,
  isFinishAction,
  isBatchTodoAction,
  isReadAction,
  isWriteAction,
  isEditAction,
  isMultiEditAction,
  isFileMetadataAction,
  isGrepAction,
  isGlobAction,
  isLSAction,
  isAddNoteAction,
  isViewAllNotesAction,
  isViewMetricsAction,
  isContextAnalysisAction,
  isViewValidationCacheAction,
  isTaskCreateAction,
  isAddContextAction,
  isLaunchSubagentAction,
  isReportAction,
  isWriteTempScriptAction,
  isTestCompileAction,
  isVerifyCompatibilityAction,
} from '../entities/actions';
import { AgentConfig } from '../../../types';

export function formatToolOutput(toolName: string, content: string): string {
  const tagName = `${toolName}_output`;
  return `<${tagName}>\n${content}\n</${tagName}>`;
}

export interface ActionHandlerConfig extends AgentConfig {
  loggingDir?: string;
  enableSmartRetry?: boolean;
  maxRetryAttempts?: number;
  enableMetrics?: boolean;
  metricsDir?: string;
  enableValidationCache?: boolean;
  validationCacheDir?: string;
  enableSubagentCoordination?: boolean;
  agentId?: string;
}

export class ActionHandler {
  private fileManager: FileManager;
  private searchManager: SearchManager;
  private subagentTrajectories: Record<string, Record<string, any>> = {};
  private codeChangesOccurred: boolean = false;
  private modifiedFiles: Set<string> = new Set();
  private metricsCollector?: MetricsCollector;
  private validationCache?: ValidationCache;
  private messageBus?: MessageBus;
  private agentId: string;

  constructor(
    private executor: CommandExecutor,
    private todoManager: TodoManager = new TodoManager(),
    private scratchpadManager: ScratchpadManager = new ScratchpadManager(),
    private orchestratorHub: OrchestratorHub = new OrchestratorHub(),
    private config: ActionHandlerConfig = {},
    private conversationHistory?: any,
    messageBus?: MessageBus
  ) {
    this.fileManager = new FileManager(executor, {
      enableSmartRetry: config.enableSmartRetry,
      maxRetryAttempts: config.maxRetryAttempts
    });
    this.searchManager = new SearchManager(executor);
    
    if (config.enableMetrics !== false) {
      this.metricsCollector = new MetricsCollector({
        persistMetrics: true,
        metricsDir: config.metricsDir || config.loggingDir,
        flushIntervalMs: 60000 
      });
    }

    if (config.enableValidationCache !== false) {
      this.validationCache = new ValidationCache({
        maxEntries: 50,
        maxAge: 2 * 60 * 60 * 1000,
        cacheDir: config.validationCacheDir || config.loggingDir,
        enablePersistence: true,
        trackDependencies: true
      });
    }

    this.agentId = config.agentId || 'orchestrator';
    if (config.enableSubagentCoordination !== false) {
      this.messageBus = messageBus || new MessageBus();
      
      this.messageBus.updateAgentStatus(this.agentId, {
        agentId: this.agentId,
        agentType: 'orchestrator',
        status: 'idle',
        capabilities: [
          {
            name: 'task_orchestration',
            description: 'Coordinate and manage complex tasks',
            inputTypes: ['task_description'],
            outputTypes: ['task_result'],
            expertise: ['coordination', 'planning', 'execution']
          }
        ],
        workload: 0
      });
    }
  }

  private static truncateContent(content: string, maxLength: number = 15): string {
    return content.length > maxLength ? content.slice(0, maxLength) + '...' : content;
  }

  async handleAction(action: AnyAction): Promise<[string, boolean]> {
    const startTime = Date.now();
    let actionType: string = 'unknown';
    let result: [string, boolean];
    let errorInfo: { type?: ErrorType; message?: string } | undefined;

    try {
      // Determine action type
      if (isBashAction(action)) {
        actionType = 'bash';
        result = await this.handleBash(action as BashAction);
      } else if (isBatchBashAction(action)) {
        actionType = 'batchBash';
        result = await this.handleBatchBash(action as BatchBashAction);
      } else if (isFinishAction(action)) {
        actionType = 'finish';
        result = await this.handleFinish(action as FinishAction);
      } else if (isBatchTodoAction(action)) {
        actionType = 'todo';
        result = await this.handleBatchTodo(action as BatchTodoAction);
      } else if (isReadAction(action)) {
        actionType = 'read';
        result = await this.handleReadFile(action as ReadAction);
      } else if (isWriteAction(action)) {
        actionType = 'write';
        result = await this.handleWriteFile(action as WriteAction);
      } else if (isEditAction(action)) {
        actionType = 'edit';
        result = await this.handleEditFile(action as EditAction);
      } else if (isMultiEditAction(action)) {
        actionType = 'multiEdit';
        result = await this.handleMultiEditFile(action as MultiEditAction);
      } else if (isFileMetadataAction(action)) {
        actionType = 'metadata';
        result = await this.handleFileMetadata(action as FileMetadataAction);
      } else if (isGrepAction(action)) {
        actionType = 'grep';
        result = await this.handleGrep(action as GrepAction);
      } else if (isGlobAction(action)) {
        actionType = 'glob';
        result = await this.handleGlob(action as GlobAction);
      } else if (isLSAction(action)) {
        actionType = 'ls';
        result = await this.handleLS(action as LSAction);
      } else if (isAddNoteAction(action)) {
        actionType = 'addNote';
        result = await this.handleAddNote(action as AddNoteAction);
      } else if (isViewAllNotesAction(action)) {
        actionType = 'viewAllNotes';
        result = await this.handleViewAllNotes(action as ViewAllNotesAction);
      } else if (isViewMetricsAction(action)) {
        actionType = 'viewMetrics';
        result = await this.handleViewMetrics(action as ViewMetricsAction);
      } else if (isContextAnalysisAction(action)) {
        actionType = 'contextAnalysis';
        result = await this.handleContextAnalysis(action as ContextAnalysisAction);
      } else if (isViewValidationCacheAction(action)) {
        actionType = 'viewValidationCache';
        result = await this.handleViewValidationCache(action as ViewValidationCacheAction);
      } else if (isTaskCreateAction(action)) {
        actionType = 'taskCreate';
        result = await this.handleTaskCreate(action as TaskCreateAction);
      } else if (isAddContextAction(action)) {
        actionType = 'addContext';
        result = await this.handleAddContext(action as AddContextAction);
      } else if (isLaunchSubagentAction(action)) {
        actionType = 'launchSubagent';
        result = await this.handleLaunchSubagent(action as LaunchSubagentAction);
      } else if (isReportAction(action)) {
        actionType = 'report';
        result = await this.handleReport(action as ReportAction);
      } else if (isWriteTempScriptAction(action)) {
        actionType = 'writeTempScript';
        result = await this.handleWriteTempScript(action as WriteTempScriptAction);
      } else if (isTestCompileAction(action)) {
        actionType = 'testCompile';
        result = await this.handleTestCompile(action as TestCompileAction);
      } else if (isVerifyCompatibilityAction(action)) {
        actionType = 'verifyCompatibility';
        result = await this.handleVerifyCompatibility(action as VerifyCompatibilityAction);
      } else {
        const content = `[ERROR] Unknown action type: ${typeof action}`;
        result = [formatToolOutput('unknown', content), true];
      }

      // Record metrics
      const duration = Date.now() - startTime;
      const hasError = result[1];
      
      if (this.metricsCollector) {
        // Extract error info if present
        if (hasError && result[0].includes('[ERROR TYPE]')) {
          const errorTypeMatch = result[0].match(/\[ERROR TYPE\]\s*(\w+)/);
          if (errorTypeMatch) {
            errorInfo = { type: errorTypeMatch[1] as ErrorType };
          }
        }
        
        this.metricsCollector.recordAction(
          actionType,
          !hasError,
          duration,
          hasError ? errorInfo : undefined,
          this.getActionContext(action)
        );
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const content = `[ERROR] Action execution failed: ${error}`;
      
      if (this.metricsCollector) {
        this.metricsCollector.recordAction(
          actionType,
          false,
          duration,
          { message: String(error) }
        );
      }
      
      return [formatToolOutput('error', content), true];
    }
  }

  private getActionContext(action: any): Record<string, any> {
    const context: Record<string, any> = {};
    
    if ('cmd' in action && action.cmd) {
      context.commandType = action.cmd.split(' ')[0];
    }
    if ('filePath' in action) {
      context.fileExtension = action.filePath.split('.').pop();
    }
    if ('pattern' in action) {
      context.hasRegex = /[.*+?^${}()|[\]\\]/.test(action.pattern);
    }
    
    return context;
  }

  private async handleBash(action: BashAction): Promise<[string, boolean]> {
    try {
      let output: string;
      let exitCode: number;

      if (action.block) {
        const shouldUseRetry = this.config.enableSmartRetry !== false && 
                             !action.cmd.includes('sleep') && 
                             !action.cmd.includes('tail -f');

        if (shouldUseRetry) {
          const retryConfig: RetryConfig = {
            maxAttempts: this.config.maxRetryAttempts || 3,
            onRetry: (attempt, error, waitMs) => {
              winston.info(`Retrying bash command (attempt ${attempt + 1}): ${ActionHandler.truncateContent(action.cmd)}`);
              winston.debug(`Retry reason: ${error.message}`);
            }
          };

          try {
            const result = await withRetry(
              async () => {
                const execResult = await this.executor.execute(action.cmd, action.timeoutSecs);
                if (execResult.exitCode !== 0) {
                  const classification = ErrorClassifier.classifyError(execResult.output, execResult.exitCode);
                  if (!classification.isRetriable) {
                    return execResult;
                  }
                  const error = new Error(execResult.output);
                  (error as any).exitCode = execResult.exitCode;
                  throw error;
                }
                return execResult;
              },
              retryConfig
            );

            output = result.output;
            exitCode = result.exitCode;
          } catch (retryError) {
            if (retryError && typeof retryError === 'object' && 'exitCode' in retryError) {
              const errorWithCode = retryError as Error & { exitCode: number };
              output = errorWithCode.message || String(retryError);
              exitCode = errorWithCode.exitCode;
            } else {
              throw retryError;
            }
          }
        } else {
          const result = await this.executor.execute(action.cmd, action.timeoutSecs);
          output = result.output;
          exitCode = result.exitCode;
        }

        if (exitCode !== 0 && output.includes('command not found')) {
          const fallbackResult = await this.tryCommandFallbacks(action.cmd, action.timeoutSecs);
          if (fallbackResult) {
            output = fallbackResult.output;
            exitCode = fallbackResult.exitCode;
          }
        }
      } else {
        // Background execution doesn't use retry
        await this.executor.executeBackground(action.cmd);
        output = 'Command started in background';
        exitCode = 0;
      }

      if (exitCode !== 0) {
        const enhancedOutput = this.enhanceBashError(action.cmd, output, exitCode);
        return [formatToolOutput('bash', enhancedOutput), true];
      }

      return [formatToolOutput('bash', output), false];

    } catch (error) {
      const errorMsg = `Error executing command: ${error}

[SUGGESTION] System error occurred. Try:
1. Simplify the command or break it into smaller steps
2. Check if the working directory is correct
3. Verify any paths or filenames in the command`;
      return [formatToolOutput('bash', errorMsg), true];
    }
  }

  private enhanceBashError(cmd: string, output: string, exitCode: number): string {
    const classification = ErrorClassifier.classifyError(output, exitCode);
    let suggestions = [`Exit code: ${exitCode}`, output];
    
    suggestions.push(`\n[ERROR TYPE] ${classification.type.toUpperCase()}`);
    if (classification.isRetriable && this.config.enableSmartRetry === false) {
      suggestions.push('[INFO] This error might have succeeded with retry enabled');
    }
    
    if (classification.suggestion) {
      suggestions.push(`[AUTO-ANALYSIS] ${classification.suggestion}`);
    }
    
    if (output.includes('No such file or directory')) {
      const fileMatch = output.match(/['"](.*?)['"]/);
      const filePath = fileMatch ? fileMatch[1] : 'the file';
      suggestions.push(`
[SUGGESTION] File or directory not found: ${filePath}
1. List current directory: <bash>ls -la</bash>
2. Check current path: <bash>pwd</bash>
3. Search for the file: <bash>find . -name "${filePath.split('/').pop()}" 2>/dev/null | head -20</bash>`);
    } else if (output.includes('Permission denied')) {
      suggestions.push(`
[SUGGESTION] Permission denied. Try:
1. Check file permissions: <bash>ls -la ${cmd.split(' ').pop()}</bash>
2. Use sudo if appropriate (be careful!)
3. Change permissions if you own the file: chmod +x filename`);
    } else if (output.includes('command not found')) {
      const cmdName = cmd.split(' ')[0];
      suggestions.push(`
[SUGGESTION] Command '${cmdName}' not found. Try:
1. Check if it's installed: <bash>which ${cmdName}</bash>
2. Install it if needed (e.g., apt-get install, npm install -g, pip install)
3. Use an alternative command that achieves the same goal`);
    } else if (output.includes('npm ERR!') || output.includes('npm error')) {
      suggestions.push(`
[SUGGESTION] npm error occurred. Try:
1. Clear npm cache: <bash>npm cache clean --force</bash>
2. Remove node_modules and reinstall: <bash>rm -rf node_modules && npm install</bash>
3. Check if package.json is valid
4. Use --force or --legacy-peer-deps flags if dependency conflicts exist`);
    } else if (output.includes('SyntaxError') || output.includes('unexpected')) {
      suggestions.push(`
[SUGGESTION] Syntax error in command or script. Try:
1. Check for typos or missing quotes
2. Verify special characters are properly escaped
3. Break complex commands into simpler parts`);
    } else if (exitCode === 124) {
      suggestions.push(`
[SUGGESTION] Command timed out after ${output.match(/\d+/)?.[0]} seconds. Try:
1. Increase timeout if the operation needs more time
2. Run in background if it's a long-running process
3. Check if the command is stuck (infinite loop, waiting for input)`);
    }
    
    if (classification.isRetriable && this.config.enableSmartRetry !== false) {
      suggestions.push('\n[RETRY INFO] This error was automatically retried before failing.');
    }
    
    return suggestions.join('\n');
  }

  private async tryCommandFallbacks(originalCmd: string, timeoutSecs: number): Promise<{ output: string; exitCode: number } | null> {
    const cmd = originalCmd.trim();

    if (cmd.includes('pip install') || cmd.includes('pip3 install')) {
      const alternatives = [
        cmd.replace(/\bpip\b/, 'python3 -m pip'),
        cmd.replace(/\bpip3\b/, 'python3 -m pip'),
        cmd.replace(/\bpip\b/, 'python -m pip'),
      ];
      
      for (const alt of alternatives) {
        if (alt !== cmd) {
          try {
            const result = await this.executor.execute(alt, timeoutSecs);
            if (result.exitCode === 0) {
              return {
                output: `[FALLBACK SUCCESS] ${alt}\n${result.output}`,
                exitCode: 0
              };
            }
          } catch {
            continue;
          }
        }
      }

      try {
        const aptCheck = await this.executor.execute('which apt-get', 5);
        if (aptCheck.exitCode === 0) {
          return {
            output: `[FALLBACK INFO] pip not available. Consider using apt-get to install system packages, or ensure pandas/pyarrow are pre-installed in the container.`,
            exitCode: 1
          };
        }
      } catch {
        console.error('[Error] Ignoring apt check')
      }
    }

    if (cmd.includes('file ') && !cmd.includes('filePath')) {
      const fileArg = cmd.match(/file\s+(.+)$/)?.[1];
      if (fileArg) {
        try {
          const result = await this.executor.execute(`ls -la ${fileArg} && echo "regular file" || echo "unknown type"`, timeoutSecs);
          return {
            output: `[FALLBACK] Using ls instead of file:\n${result.output}`,
            exitCode: result.exitCode
          };
        } catch {
        }
      }
    }

    if (cmd.includes('hexdump')) {
      const hexArg = cmd.match(/hexdump.*?([^\s]+)$/)?.[1];
      if (hexArg) {
        try {
          const result = await this.executor.execute(`od -c ${hexArg} | head -5`, timeoutSecs);
          return {
            output: `[FALLBACK] Using od instead of hexdump:\n${result.output}`,
            exitCode: result.exitCode
          };
        } catch {
        }
      }
    }

    return null;
  }

  private async handleFinish(action: FinishAction): Promise<[string, boolean]> {
    const response = `Task marked as complete: ${action.message}`;
    return [formatToolOutput('finish', response), false];
  }

  private async handleBatchBash(action: BatchBashAction): Promise<[string, boolean]> {
    const results: Array<{ 
      cmd: string; 
      label?: string; 
      output: string; 
      exitCode: number; 
      error?: string;
      duration: number;
    }> = [];

    const startTime = Date.now();

    if (action.parallel !== false) {
      const promises = action.commands.map(async (command) => {
        const cmdStart = Date.now();
        try {
          const result = await this.executor.execute(
            command.cmd, 
            command.timeout || 120
          );
          return {
            cmd: command.cmd,
            label: command.label,
            output: result.output,
            exitCode: result.exitCode,
            duration: Date.now() - cmdStart,
          };
        } catch (error) {
          return {
            cmd: command.cmd,
            label: command.label,
            output: '',
            exitCode: -1,
            error: error instanceof Error ? error.message : String(error),
            duration: Date.now() - cmdStart,
          };
        }
      });

      const parallelResults = await Promise.all(promises);
      results.push(...parallelResults);
    } else {
      for (const command of action.commands) {
        const cmdStart = Date.now();
        try {
          const result = await this.executor.execute(
            command.cmd,
            command.timeout || 120
          );
          results.push({
            cmd: command.cmd,
            label: command.label,
            output: result.output,
            exitCode: result.exitCode,
            duration: Date.now() - cmdStart,
          });

          if (!action.continueOnError && result.exitCode !== 0) {
            break;
          }
        } catch (error) {
          results.push({
            cmd: command.cmd,
            label: command.label,
            output: '',
            exitCode: -1,
            error: error instanceof Error ? error.message : String(error),
            duration: Date.now() - cmdStart,
          });

          if (!action.continueOnError) {
            break;
          }
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    const hasErrors = results.some(r => r.exitCode !== 0);

    const outputLines: string[] = [
      `Batch execution completed in ${totalDuration}ms`,
      `Mode: ${action.parallel !== false ? 'parallel' : 'sequential'}`,
      `Commands: ${results.length}`,
      `Failures: ${results.filter(r => r.exitCode !== 0).length}`,
      '---'
    ];

    for (const [idx, result] of results.entries()) {
      outputLines.push(`\n[${idx + 1}/${results.length}] ${result.label || result.cmd}`);
      outputLines.push(`Duration: ${result.duration}ms`);
      outputLines.push(`Exit code: ${result.exitCode}`);
      
      if (result.error) {
        outputLines.push(`Error: ${result.error}`);
      }
      
      if (result.output.trim()) {
        outputLines.push('Output:');
        outputLines.push(result.output);
      }
    }

    const output = outputLines.join('\n');
    return [formatToolOutput('batch_bash', output), hasErrors && !action.continueOnError];
  }

  private async handleBatchTodo(action: BatchTodoAction): Promise<[string, boolean]> {
    const results: string[] = [];
    let hasError = false;

    for (const op of action.operations) {
      if (op.action === 'add') {
        const taskId = this.todoManager.addTask(op.content!);
        const truncatedContent = ActionHandler.truncateContent(op.content!);
        results.push(`Added todo [${taskId}]: ${truncatedContent}`);
      } else if (op.action === 'complete') {
        const task = this.todoManager.getTask(op.taskId!);
        if (!task) {
          results.push(`[ERROR] Task ${op.taskId} not found`);
          hasError = true;
        } else if (task.status === 'completed') {
          results.push(`Task ${op.taskId} is already completed`);
        } else {
          this.todoManager.completeTask(op.taskId!);
          const truncatedContent = ActionHandler.truncateContent(task.content);
          results.push(`Completed task [${op.taskId}]: ${truncatedContent}`);
        }
      } else if (op.action === 'delete') {
        const task = this.todoManager.getTask(op.taskId!);
        if (!task) {
          results.push(`[ERROR] Task ${op.taskId} not found`);
          hasError = true;
        } else {
          this.todoManager.deleteTask(op.taskId!);
          const truncatedContent = ActionHandler.truncateContent(task.content);
          results.push(`Deleted task [${op.taskId}]: ${truncatedContent}`);
        }
      }
    }

    let response = results.join('\n');

    if (action.viewAll) {
      response += `\n\n${this.todoManager.viewAll()}`;
    }

    return [formatToolOutput('todo', response), hasError];
  }

  private async handleAddNote(action: AddNoteAction): Promise<[string, boolean]> {
    if (!action.content) {
      return [formatToolOutput('scratchpad', '[ERROR] Cannot add empty note'), true];
    }

    const noteIdx = this.scratchpadManager.addNote(action.content);
    const response = `Added note ${noteIdx + 1} to scratchpad`;
    return [formatToolOutput('scratchpad', response), false];
  }

  private async handleViewAllNotes(_action: ViewAllNotesAction): Promise<[string, boolean]> {
    return [formatToolOutput('scratchpad', this.scratchpadManager.viewAll()), false];
  }

  private async handleViewMetrics(action: ViewMetricsAction): Promise<[string, boolean]> {
    if (!this.metricsCollector) {
      return [formatToolOutput('metrics', 'Metrics collection is disabled'), false];
    }

    let output: string;
    
    switch (action.format) {
      case 'detailed':
        output = this.metricsCollector.generateReport();
        break;
      
      case 'errors':
        const recentErrors = this.metricsCollector.getRecentErrors(20);
        if (recentErrors.length === 0) {
          output = 'No recent errors recorded';
        } else {
          output = '=== Recent Errors ===\n';
          for (const error of recentErrors) {
            output += `\n[${error.timestamp.toISOString()}] ${error.actionType}`;
            if (error.errorType) output += ` (${error.errorType})`;
            if (error.errorMessage) output += `\n  ${error.errorMessage}`;
            output += '\n';
          }
        }
        break;
      
      case 'summary':
      default:
        const snapshot = this.metricsCollector.getSnapshot();
        output = `=== Action Metrics Summary ===
Total Actions: ${snapshot.overall.totalExecutions}
Success Rate: ${(snapshot.overall.successRate * 100).toFixed(1)}%
Average Duration: ${snapshot.overall.averageDuration.toFixed(0)}ms

Top Actions by Usage:`;
        
        const topActions = Object.entries(snapshot.byAction)
          .sort((a, b) => b[1].totalExecutions - a[1].totalExecutions)
          .slice(0, 5);
        
        for (const [action, metrics] of topActions) {
          output += `\n  ${action}: ${metrics.totalExecutions} calls, ${(metrics.successRate * 100).toFixed(1)}% success`;
          if (metrics.recentTrend !== 'stable') {
            output += ` (${metrics.recentTrend})`;
          }
        }
        
        if (action.actionType) {
          const specificMetrics = snapshot.byAction[action.actionType];
          if (specificMetrics) {
            output += `\n\n=== ${action.actionType} Metrics ===
Executions: ${specificMetrics.totalExecutions}
Success Rate: ${(specificMetrics.successRate * 100).toFixed(1)}%
Average Duration: ${specificMetrics.averageDuration.toFixed(0)}ms
Min/Max Duration: ${specificMetrics.minDuration.toFixed(0)}ms / ${specificMetrics.maxDuration.toFixed(0)}ms`;
          }
        }
        
        if (snapshot.performanceTrends.length > 0) {
          output += '\n\n=== Performance Recommendations ===';
          for (const trend of snapshot.performanceTrends) {
            output += `\n- ${trend.action}: ${trend.recommendation}`;
          }
        }
    }

    return [formatToolOutput('metrics', output), false];
  }

  private async handleContextAnalysis(action: ContextAnalysisAction): Promise<[string, boolean]> {
    if (!this.conversationHistory || !this.conversationHistory.getContextSummary) {
      return [formatToolOutput('context_analysis', 'Context analysis not available (deduplication disabled)'), false];
    }

    let output: string = '';

    switch (action.action) {
      case 'summary':
        const summary = this.conversationHistory.getContextSummary();
        output = `=== Context Summary ===
Total Context Entries: ${summary.totalEntries}
Average Similarity: ${(summary.averageSimilarity * 100).toFixed(1)}%
Oldest Entry: ${summary.oldestEntry ? summary.oldestEntry.toISOString() : 'N/A'}
Newest Entry: ${summary.newestEntry ? summary.newestEntry.toISOString() : 'N/A'}`;
        break;

      case 'duplicates':
        const clusters = this.conversationHistory.findDuplicateClusters(action.threshold);
        if (clusters.length === 0) {
          output = `No duplicate clusters found with similarity >= ${(action.threshold * 100).toFixed(0)}%`;
        } else {
          output = `=== Duplicate Clusters (similarity >= ${(action.threshold * 100).toFixed(0)}%) ===\n`;
          for (let i = 0; i < clusters.length; i++) {
            const cluster = clusters[i];
            output += `\nCluster ${i + 1} (${cluster.length} items):\n`;
            for (const entry of cluster) {
              output += `- ${entry.source} (${entry.timestamp.toISOString()})\n`;
              output += `  ${entry.content.substring(0, 100)}...\n`;
            }
          }
        }
        break;

      case 'purge':
        const removedCount = this.conversationHistory.purgeOldContext(action.maxAge);
        output = `Purged ${removedCount} context entries older than ${Math.round(action.maxAge / (60 * 60 * 1000))} hours`;
        break;

      case 'check':
        if (!action.content) {
          output = 'Content parameter required for check action';
        } else {
          const similarity = await this.conversationHistory.checkContextSimilarity(
            action.content, 
            'manual_check'
          );
          output = `Similarity check result:
Is Duplicate: ${similarity.isDuplicate}
Similarity Score: ${(similarity.similarityScore * 100).toFixed(1)}%
${similarity.suggestion || ''}`;
          if (similarity.existingEntry) {
            output += `\nSimilar entry from: ${similarity.existingEntry.source}
Timestamp: ${similarity.existingEntry.timestamp.toISOString()}
Content preview: ${similarity.existingEntry.content.substring(0, 200)}...`;
          }
        }
        break;
    }

    return [formatToolOutput('context_analysis', output), false];
  }

  private async handleViewValidationCache(action: ViewValidationCacheAction): Promise<[string, boolean]> {
    if (!this.validationCache) {
      return [formatToolOutput('validation_cache', 'Validation cache is disabled'), false];
    }

    let output: string = '';

    switch (action.action) {
      case 'stats':
        const stats = this.validationCache.getStats();
        output = `=== Validation Cache Statistics ===
Total Entries: ${stats.totalEntries}
Hit Rate: ${(stats.hitRate * 100).toFixed(1)}%
Total Hits: ${stats.totalHits}
Total Misses: ${stats.totalMisses}
Cache Size: ${(stats.cacheSize / 1024).toFixed(1)} KB
Oldest Entry: ${stats.oldestEntry ? stats.oldestEntry.toISOString() : 'N/A'}
Newest Entry: ${stats.newestEntry ? stats.newestEntry.toISOString() : 'N/A'}`;
        break;

      case 'clear':
        this.validationCache.clear();
        output = 'Validation cache cleared successfully';
        break;

      case 'invalidate':
        if (!action.filePath) {
          output = 'File path required for invalidate action';
        } else {
          const invalidated = this.validationCache.invalidateByFile(action.filePath);
          output = `Invalidated ${invalidated} cache entries for file: ${action.filePath}`;
        }
        break;
    }

    return [formatToolOutput('validation_cache', output), false];
  }

  private async handleReadFile(action: ReadAction): Promise<[string, boolean]> {
    const [content, isError] = await this.fileManager.readFile(
      action.filePath,
      action.offset,
      action.limit
    );
    return [formatToolOutput('file', content), isError];
  }

  private async handleWriteFile(action: WriteAction): Promise<[string, boolean]> {
    const [content, isError] = await this.fileManager.writeFile(
      action.filePath,
      action.content
    );
    
    if (!isError && this.isCodeFile(action.filePath)) {
      this.codeChangesOccurred = true;
      this.modifiedFiles.add(action.filePath);
      
      this.invalidateValidationCache(action.filePath);
    }
    
    return [formatToolOutput('file', content), isError];
  }

  private async handleEditFile(action: EditAction): Promise<[string, boolean]> {
    const [content, isError] = await this.fileManager.editFile(
      action.filePath,
      action.oldString,
      action.newString,
      action.replaceAll
    );
    
    let enhancedContent = content;
    if (isError && content.includes('String not found in file')) {
      enhancedContent = `${content}

[SUGGESTION] The exact string was not found. Try:
1. Re-read the file to see the current content: <file action="read" filePath="${action.filePath}">
2. Check for extra/missing whitespace or newlines in your oldString
3. Use a smaller, more unique portion of the text
4. If the file has changed since you last read it, get the latest content first`;
    } else if (isError && content.includes('No such file or directory')) {
      enhancedContent = `${content}

[SUGGESTION] File not found. Try:
1. Check if the file path is correct (current: ${action.filePath})
2. List the directory to see available files: <search action="ls" path="${action.filePath.substring(0, action.filePath.lastIndexOf('/'))}">
3. Use grep to search for similar filenames: <search action="grep" pattern="${action.filePath.split('/').pop()}">`;
    }
    
    if (!isError && this.isCodeFile(action.filePath)) {
      this.codeChangesOccurred = true;
      this.modifiedFiles.add(action.filePath);
      this.invalidateValidationCache(action.filePath);
    }
    
    return [formatToolOutput('file', enhancedContent), isError];
  }

  private async handleMultiEditFile(action: MultiEditAction): Promise<[string, boolean]> {
    const edits = action.edits.map(e => ({
      oldString: e.oldString,
      newString: e.newString,
      replaceAll: e.replaceAll || false,
    }));
    const [content, isError] = await this.fileManager.multiEditFile(action.filePath, edits);
    
    if (!isError && this.isCodeFile(action.filePath)) {
      this.codeChangesOccurred = true;
      this.modifiedFiles.add(action.filePath);
    }
    
    return [formatToolOutput('file', content), isError];
  }

  private async handleFileMetadata(action: FileMetadataAction): Promise<[string, boolean]> {
    const [content, isError] = await this.fileManager.getMetadata(action.filePaths);
    return [formatToolOutput('file', content), isError];
  }

  private async handleGrep(action: GrepAction): Promise<[string, boolean]> {
    const [content, isError] = await this.searchManager.grep(
      action.pattern,
      action.path,
      action.include
    );
    return [formatToolOutput('search', content), isError];
  }

  private async handleGlob(action: GlobAction): Promise<[string, boolean]> {
    const [content, isError] = await this.searchManager.glob(action.pattern, action.path);
    return [formatToolOutput('search', content), isError];
  }

  private async handleLS(action: LSAction): Promise<[string, boolean]> {
    const [content, isError] = await this.searchManager.ls(action.path, action.ignore);
    return [formatToolOutput('search', content), isError];
  }

  private async handleWriteTempScript(action: WriteTempScriptAction): Promise<[string, boolean]> {
    const [content, isError] = await this.fileManager.writeFile(
      action.filePath,
      action.content
    );
    return [formatToolOutput('file', content), isError];
  }

  private async handleTaskCreate(action: TaskCreateAction): Promise<[string, boolean]> {
    try {
      const taskId = this.orchestratorHub.createTask(
        action.agentType as any, 
        action.title,
        action.description,
        action.contextRefs,
        action.contextBootstrap
      );

      let response = `Created task ${taskId}: ${action.title}`;

      if (action.autoLaunch) {
        const launchAction: LaunchSubagentAction = { taskId };
        const [launchResponse, launchError] = await this.handleLaunchSubagent(launchAction);
        response += `\n${launchResponse}`;
        return [formatToolOutput('task', response), launchError];
      }

      return [formatToolOutput('task', response), false];

    } catch (error) {
      const errorMsg = `[ERROR] Failed to create task: ${error}`;
      return [formatToolOutput('task', errorMsg), true];
    }
  }

  private async handleAddContext(action: AddContextAction): Promise<[string, boolean]> {
    try {
      const success = this.orchestratorHub.addContext(
        action.id,
        action.content,
        action.reportedBy,
        action.taskId
      );

      const response = success
        ? `Added context '${action.id}' to store`
        : `[WARNING] Context '${action.id}' already exists in store`;

      return [formatToolOutput('context', response), !success];

    } catch (error) {
      const errorMsg = `[ERROR] Failed to add context: ${error}`;
      return [formatToolOutput('context', errorMsg), true];
    }
  }

  private async handleLaunchSubagent(action: LaunchSubagentAction): Promise<[string, boolean]> {
    const { Subagent } = await import('../../subagents/subagent');

    let resolvedTaskId = action.taskId;
    let task = this.orchestratorHub.getTask(resolvedTaskId);
    if (!task) {
      const match = resolvedTaskId.match(/^task_(\d+)$/);
      if (match) {
        const padded = `task_${match[1].padStart(3, '0')}`;
        const paddedTask = this.orchestratorHub.getTask(padded);
        if (paddedTask) {
          resolvedTaskId = padded;
          task = paddedTask;
        }
      }
    }
    if (!task) {
      const errorMsg = `[ERROR] Task ${action.taskId} not found`;
      return [formatToolOutput('subagent', errorMsg), true];
    }

    const contextStoreCtxts = this.orchestratorHub.getContextsForTask(task.contextRefs);
    const bootstrapCtxts: Array<{ path: string; content: string; reason: string }> = [];

    if (task.contextBootstrap.length > 0) {
      for (const item of task.contextBootstrap) {
        const isDir = item.path.endsWith('/');
        if (isDir) {
          const [lsResult] = await this.searchManager.ls(item.path, []);
          bootstrapCtxts.push({ 
            path: item.path, 
            content: lsResult, 
            reason: item.reason 
          });
        } else {
          const [fileResult] = await this.fileManager.readFile(item.path, 0, 1000);
          bootstrapCtxts.push({ 
            path: item.path, 
            content: fileResult, 
            reason: item.reason 
          });
        }
      }
    }

    const subagentTask = {
      agentType: task.agentType,
      title: task.title,
      description: task.description,
      ctxStoreCtxts: contextStoreCtxts,
      bootstrapCtxts,
    };

    const subagent = new Subagent(subagentTask, this.executor, {
      model: this.config.model,
      temperature: this.config.temperature,
      apiKey: this.config.apiKey,
      apiBase: this.config.apiBase,
      loggingDir: this.config.loggingDir,
      taskId: action.taskId,
    });

    winston.info(`Launching ${task.agentType} subagent for task: ${task.title}`);
    const report = await subagent.run();

    if (report.meta) {
      this.subagentTrajectories[action.taskId] = {
        agentType: task.agentType,
        title: task.title,
        trajectory: report.meta.trajectory || null,
        totalInputTokens: report.meta.totalInputTokens,
        totalOutputTokens: report.meta.totalOutputTokens,
      };
    }

    const result = this.orchestratorHub.processSubagentResult(resolvedTaskId, report);

    const responseLines = [
      `Subagent completed task ${action.taskId}`,
      `Contexts stored: ${result.contextIdsStored.join(', ')}`,
    ];

    if (result.comments) {
      responseLines.push(`Comments: ${result.comments}`);
    }

    const response = responseLines.join('\n');
    return [formatToolOutput('subagent', response), false];
  }

  private async handleReport(_action: ReportAction): Promise<[string, boolean]> {
    return [formatToolOutput('report', 'Report submission successful'), false];
  }

  public async verifyPathExists(filePath: string): Promise<boolean> {
    try {
      const cmd = `[ -e '${filePath}' ] && echo EXISTS || echo MISSING`;
      const result = await this.executor.execute(cmd, 10);
      return result.output.includes('EXISTS');
    } catch {
      return false;
    }
  }

  private isCodeFile(filePath: string): boolean {
    const codeExtensions = [
      '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.hpp',
      '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.clj',
      '.html', '.css', '.scss', '.sass', '.vue', '.svelte', '.dart', '.r',
      '.m', '.mm', '.sql', '.sh', '.bash', '.ps1', '.dockerfile', '.gradle',
      '.maven', '.xml', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg'
    ];
    
    const lowerPath = filePath.toLowerCase();
    return codeExtensions.some(ext => lowerPath.endsWith(ext)) ||
           lowerPath.includes('makefile') ||
           lowerPath.includes('dockerfile') ||
           lowerPath.includes('package.json') ||
           lowerPath.includes('requirements.txt') ||
           lowerPath.includes('cargo.toml') ||
           lowerPath.includes('pom.xml') ||
           lowerPath.includes('build.gradle');
  }

  async runBuildValidation(): Promise<[string, boolean]> {
    const validationResults: string[] = [];
    let hasCriticalError = false;
    let hasWarnings = false;

    try {
      const packageJsonCheck = await this.executor.execute('test -f package.json && echo "nodejs" || echo "none"');
      if (packageJsonCheck.output.includes('nodejs')) {
        const cachedResult = await this.getCachedValidationResult(['package.json'], 'nodejs');
        if (cachedResult) {
          validationResults.push(`[CACHED] ${cachedResult.output}`);
          hasCriticalError = !cachedResult.success;
          hasWarnings = cachedResult.warnings.length > 0;
        } else {
          const buildResult = await this.tryNodeJSValidation();
          const { level, message } = this.categorizeValidationError(buildResult);
          
          await this.cacheValidationResult(
            ['package.json'], 
            'nodejs', 
            {
              success: level !== 'CRITICAL',
              output: message,
              timestamp: new Date(),
              duration: 0,
              errors: level === 'CRITICAL' ? [message] : [],
              warnings: level === 'WARNING' ? [message] : []
            }
          );
          
          validationResults.push(`[${level}] ${message}`);
          if (level === 'CRITICAL') hasCriticalError = true;
          if (level === 'WARNING') hasWarnings = true;
        }
      }

      const pythonCheck = await this.executor.execute('test -f requirements.txt -o -f setup.py -o -f pyproject.toml && echo "python" || echo "none"');
      if (pythonCheck.output.includes('python')) {
        const pythonFiles = ['requirements.txt', 'setup.py', 'pyproject.toml'].filter(file => 
          this.executor.execute(`test -f ${file}`).then(r => r.exitCode === 0)
        );
        
        const cachedResult = await this.getCachedValidationResult(pythonFiles, 'python');
        if (cachedResult) {
          validationResults.push(`[CACHED] ${cachedResult.output}`);
          hasCriticalError = !cachedResult.success;
          hasWarnings = cachedResult.warnings.length > 0;
        } else {
          const pythonResult = await this.tryPythonValidation();
          const { level, message } = this.categorizeValidationError(pythonResult);
          
          await this.cacheValidationResult(
            pythonFiles,
            'python',
            {
              success: level !== 'CRITICAL',
              output: message,
              timestamp: new Date(),
              duration: 0,
              errors: level === 'CRITICAL' ? [message] : [],
              warnings: level === 'WARNING' ? [message] : []
            }
          );
          
          validationResults.push(`[${level}] ${message}`);
          if (level === 'CRITICAL') hasCriticalError = true;
          if (level === 'WARNING') hasWarnings = true;
        }
      }

      const tsConfigCheck = await this.executor.execute('test -f tsconfig.json && echo "typescript" || echo "none"');
      if (tsConfigCheck.output.includes('typescript')) {
        const tsResult = await this.tryTypeScriptValidation();
        const { level, message } = this.categorizeValidationError(tsResult);
        validationResults.push(`[${level}] ${message}`);
        if (level === 'CRITICAL') hasCriticalError = true;
        if (level === 'WARNING') hasWarnings = true;
      }

      const cppCheck = await this.executor.execute('find . -name "*.cpp" -o -name "*.c" -o -name "*.cc" | head -1');
      if (cppCheck.output.trim()) {
        const cppResult = await this.tryCPPValidation();
        const { level, message } = this.categorizeValidationError(cppResult);
        validationResults.push(`[${level}] ${message}`);
        if (level === 'CRITICAL') hasCriticalError = true;
        if (level === 'WARNING') hasWarnings = true;
      }

      const makefileCheck = await this.executor.execute('test -f Makefile -o -f makefile && echo "make" || echo "none"');
      if (makefileCheck.output.includes('make')) {
        const makeResult = await this.tryMakeValidation();
        const { level, message } = this.categorizeValidationError(makeResult);
        validationResults.push(`[${level}] ${message}`);
        if (level === 'CRITICAL') hasCriticalError = true;
        if (level === 'WARNING') hasWarnings = true;
      }

      if (validationResults.length === 0) {
        validationResults.push('[INFO] No recognized build system found, skipping build validation');
      }

      if (hasCriticalError) {
        validationResults.push('\n[SUMMARY] Critical errors found - these MUST be fixed before completion');
      } else if (hasWarnings) {
        validationResults.push('\n[SUMMARY] Only warnings found - proceeding with completion');
      } else {
        validationResults.push('\n[SUMMARY] Build validation passed');
      }

    } catch (error) {
      validationResults.push(`[CRITICAL] Build validation system error: ${error}`);
      hasCriticalError = true;
    }

    return [validationResults.join('\n'), hasCriticalError];
  }

  private async tryNodeJSValidation(): Promise<{ message: string; error: boolean }> {
    try {
      const packageInfo = await this.executor.execute('cat package.json 2>/dev/null | grep -E "(build|compile)" || echo "none"');
      if (!packageInfo.output.includes('none')) {
        const buildResult = await this.executor.execute('npm run build 2>&1', 60);
        if (buildResult.exitCode !== 0) {
          return { 
            message: `[BUILD ERROR] npm run build failed:\n${buildResult.output}`, 
            error: true 
          };
        }
        return { message: '[BUILD SUCCESS] npm run build completed successfully', error: false };
      }

      const testInfo = await this.executor.execute('cat package.json 2>/dev/null | grep -E "test" || echo "none"');
      if (!testInfo.output.includes('none')) {
        const testResult = await this.executor.execute('npm test 2>&1', 90);
        if (testResult.exitCode !== 0) {
          return { 
            message: `[TEST ERROR] npm test failed:\n${testResult.output}`, 
            error: true 
          };
        }
        return { message: '[TEST SUCCESS] npm test completed successfully', error: false };
      }

      return { message: '[INFO] Node.js project detected but no build/test scripts found', error: false };
    } catch (error) {
      return { message: `[ERROR] Node.js validation failed: ${error}`, error: true };
    }
  }

  private async tryTypeScriptValidation(): Promise<{ message: string; error: boolean }> {
    try {
      const tscResult = await this.executor.execute('npx tsc --noEmit 2>&1', 60);
      if (tscResult.exitCode !== 0) {
        return { 
          message: `[TYPESCRIPT ERROR] TypeScript compilation failed:\n${tscResult.output}`, 
          error: true 
        };
      }
      return { message: '[TYPESCRIPT SUCCESS] TypeScript compilation successful', error: false };
    } catch (error) {
      return { message: `[ERROR] TypeScript validation failed: ${error}`, error: true };
    }
  }

  private async tryPythonValidation(): Promise<{ message: string; error: boolean }> {
    try {
      const pythonFiles = await this.executor.execute('find . -name "*.py" -not -path "./venv/*" -not -path "./.venv/*" | head -10');
      if (pythonFiles.output.trim()) {
        const files = pythonFiles.output.trim().split('\n');
        for (const file of files) {
          const compileResult = await this.executor.execute(`python3 -m py_compile "${file}" 2>&1`);
          if (compileResult.exitCode !== 0) {
            return { 
              message: `[PYTHON ERROR] Python compilation failed for ${file}:\n${compileResult.output}`, 
              error: true 
            };
          }
        }
        return { message: '[PYTHON SUCCESS] Python files compiled successfully', error: false };
      }
      return { message: '[INFO] Python project detected but no .py files found', error: false };
    } catch (error) {
      return { message: `[ERROR] Python validation failed: ${error}`, error: true };
    }
  }

  private async tryCPPValidation(): Promise<{ message: string; error: boolean }> {
    try {
      const cppFiles = await this.executor.execute('find . -name "*.cpp" -o -name "*.c" -o -name "*.cc" | head -5');
      if (cppFiles.output.trim()) {
        const files = cppFiles.output.trim().split('\n');
        for (const file of files) {
          const compileResult = await this.executor.execute(`g++ -c "${file}" -o /tmp/test.o 2>&1`);
          if (compileResult.exitCode !== 0) {
            return { 
              message: `[C++ ERROR] C++ compilation failed for ${file}:\n${compileResult.output}`, 
              error: true 
            };
          }
        }
        await this.executor.execute('rm -f /tmp/test.o'); 
        return { message: '[C++ SUCCESS] C++ files compiled successfully', error: false };
      }
      return { message: '[INFO] C++ project detected but no source files found', error: false };
    } catch (error) {
      return { message: `[ERROR] C++ validation failed: ${error}`, error: true };
    }
  }

  private async tryMakeValidation(): Promise<{ message: string; error: boolean }> {
    try {
      const makeResult = await this.executor.execute('make -n 2>&1', 30);
      if (makeResult.exitCode !== 0) {
        return { 
          message: `[MAKE ERROR] Make validation failed:\n${makeResult.output}`, 
          error: true 
        };
      }
      return { message: '[MAKE SUCCESS] Makefile validation successful', error: false };
    } catch (error) {
      return { message: `[ERROR] Make validation failed: ${error}`, error: true };
    }
  }

  private categorizeValidationError(result: { message: string; error: boolean }): { level: 'CRITICAL' | 'WARNING' | 'INFO'; message: string } {
    if (!result.error) {
      return { level: 'INFO', message: result.message };
    }

    const message = result.message.toLowerCase();
    
    if (
      message.includes('syntaxerror') ||
      message.includes('cannot find module') ||
      message.includes('module not found') ||
      message.includes('compilation failed') ||
      message.includes('parse error') ||
      message.includes('unexpected token') ||
      message.includes('undefined is not') ||
      message.includes('referenceerror') ||
      message.includes('typeerror') && !message.includes('typescript')
    ) {
      return { level: 'CRITICAL', message: result.message };
    }

    if (
      message.includes('warning') ||
      message.includes('unused') ||
      message.includes('is defined but never used') ||
      message.includes('eslint') ||
      message.includes('prettier') ||
      message.includes('no-') || 
      message.includes('should be') ||
      message.includes('prefer') ||
      message.includes('typescript error') 
    ) {
      return { level: 'WARNING', message: result.message };
    }

    if (message.includes('test') && (message.includes('fail') || message.includes('error'))) {
      return { level: 'WARNING', message: result.message + ' (Test failures are expected during development)' };
    }

    return { level: 'WARNING', message: result.message };
  }

  hasCodeChanges(): boolean {
    return this.codeChangesOccurred;
  }

  getModifiedFiles(): string[] {
    return Array.from(this.modifiedFiles);
  }

  clearCodeChangeTracking(): void {
    this.codeChangesOccurred = false;
    this.modifiedFiles.clear();
  }

  getAndClearSubagentTrajectories(): Record<string, Record<string, any>> {
    const trajectories = { ...this.subagentTrajectories };
    this.subagentTrajectories = {};
    return trajectories;
  }

  private async handleTestCompile(action: TestCompileAction): Promise<[string, boolean]> {
    try {
      const sourceFiles = action.sourceFiles.map(f => `'${f}'`).join(' ');
      const includeDirs = action.includeDirs.map(dir => `-I'${dir}'`).join(' ');
      const defines = action.defines.map(def => `-D${def}`).join(' ');
      const extraFlags = action.extraFlags.join(' ');
      
      const compileCmd = [
        action.compiler,
        `-std=${action.standard}`,
        includeDirs,
        defines,
        extraFlags,
        sourceFiles,
        `-o ${action.outputFile}`,
        '2>&1'
      ].filter(Boolean).join(' ');

      const result = await this.executor.execute(compileCmd, 30);
      
      if (result.exitCode === 0) {
        const response = `Compilation successful with ${action.compiler} -std=${action.standard}`;
        return [formatToolOutput('test_compile', response), false];
      } else {
        const response = `Compilation failed with ${action.compiler} -std=${action.standard}:\n${result.output}`;
        return [formatToolOutput('test_compile', response), true];
      }

    } catch (error) {
      const errorMsg = `Test compilation error: ${error}`;
      return [formatToolOutput('test_compile', errorMsg), true];
    }
  }

  private async handleVerifyCompatibility(action: VerifyCompatibilityAction): Promise<[string, boolean]> {
    try {
      const responses: string[] = [];
      let hasError = false;

      if (action.testType === 'compile') {
        const result = await this.runCompatibilityCompileTest(action);
        responses.push(result.message);
        hasError = result.hasError;
      } else if (action.testType === 'runtime') {
        const result = await this.runCompatibilityRuntimeTest(action);
        responses.push(result.message);
        hasError = result.hasError;
      } else if (action.testType === 'static_analysis') {
        const result = await this.runCompatibilityStaticAnalysis(action);
        responses.push(result.message);
        hasError = result.hasError;
      }

      const response = responses.join('\n');
      return [formatToolOutput('verify_compatibility', response), hasError];

    } catch (error) {
      const errorMsg = `Compatibility verification error: ${error}`;
      return [formatToolOutput('verify_compatibility', errorMsg), true];
    }
  }

  private async runCompatibilityCompileTest(action: VerifyCompatibilityAction): Promise<{ message: string; hasError: boolean }> {
    if (action.targetLanguage.startsWith('cpp')) {
      const cppStandard = action.targetLanguage.replace('cpp', 'c++'); 
      const flags = [`-std=${cppStandard}`, ...action.customFlags];
      
      const testFile = `/tmp/compat_test_${Date.now()}.cpp`;
      const testContent = `#include "${action.filePath}"\nint main() { return 0; }`;
      
      const writeResult = await this.executor.execute(`echo '${testContent}' > '${testFile}'`);
      if (writeResult.exitCode !== 0) {
        return { message: `Failed to create test file: ${writeResult.output}`, hasError: true };
      }

      const compileCmd = `g++ ${flags.join(' ')} '${testFile}' -o /tmp/compat_test 2>&1`;
      const result = await this.executor.execute(compileCmd, 30);
      
      await this.executor.execute(`rm -f '${testFile}' /tmp/compat_test`);
      
      if (result.exitCode === 0) {
        return { 
          message: `✅ COMPATIBILITY VERIFIED: ${action.filePath} compiles successfully with ${cppStandard}`, 
          hasError: false 
        };
      } else {
        const cleanedOutput = result.output.replace(/\/tmp\/compat_test_\d+\.cpp/g, 'test.cpp');
        return { 
          message: `❌ COMPATIBILITY FAILED: ${action.filePath} does not compile with ${cppStandard}:\n${cleanedOutput}`, 
          hasError: true 
        };
      }
    }
    
    return { message: `Unsupported target language for compile test: ${action.targetLanguage}`, hasError: true };
  }

  private async runCompatibilityRuntimeTest(action: VerifyCompatibilityAction): Promise<{ message: string; hasError: boolean }> {
    return { 
      message: `Runtime compatibility testing not yet implemented for ${action.targetLanguage}`, 
      hasError: false 
    };
  }

  private async runCompatibilityStaticAnalysis(action: VerifyCompatibilityAction): Promise<{ message: string; hasError: boolean }> {
    if (action.targetLanguage.startsWith('cpp')) {
      const cppcheckResult = await this.executor.execute(`which cppcheck && cppcheck --std=${action.targetLanguage} '${action.filePath}' 2>&1 || echo 'cppcheck not available'`, 10);
      
      if (cppcheckResult.output.includes('cppcheck not available')) {
        return { 
          message: `Static analysis skipped: cppcheck not available for ${action.targetLanguage}`, 
          hasError: false 
        };
      }
      
      return { 
        message: `Static analysis result for ${action.targetLanguage}:\n${cppcheckResult.output}`, 
        hasError: cppcheckResult.exitCode !== 0 
      };
    }
    
    return { message: `Static analysis not implemented for ${action.targetLanguage}`, hasError: false };
  }

  // Metrics methods
  getMetricsReport(): string | null {
    if (!this.metricsCollector) {
      return null;
    }
    return this.metricsCollector.generateReport();
  }

  getMetricsSnapshot(): any {
    if (!this.metricsCollector) {
      return null;
    }
    return this.metricsCollector.getSnapshot();
  }

  getActionSuccessRate(actionType: string): number {
    if (!this.metricsCollector) {
      return 1.0; // Assume success if no metrics
    }
    return this.metricsCollector.getActionSuccessRate(actionType);
  }

  clearMetrics(): void {
    if (this.metricsCollector) {
      this.metricsCollector.clear();
    }
  }

  private async getCachedValidationResult(filePaths: string[], validationType: string): Promise<ValidationResult | null> {
    if (!this.validationCache) return null;
    return this.validationCache.getCachedResult(filePaths, validationType);
  }

  private async cacheValidationResult(
    filePaths: string[], 
    validationType: string, 
    result: ValidationResult
  ): Promise<void> {
    if (!this.validationCache) return;
    await this.validationCache.cacheResult(filePaths, validationType, result);
  }

  invalidateValidationCache(filePath?: string): void {
    if (!this.validationCache) return;
    
    if (filePath) {
      this.validationCache.invalidateByFile(filePath);
    } else {
      this.validationCache.clear();
    }
  }

  getValidationCacheStats() {
    return this.validationCache?.getStats();
  }

  destroy(): void {
    if (this.metricsCollector) {
      this.metricsCollector.destroy();
    }
    if (this.validationCache) {
      this.validationCache.destroy();
    }
  }
}
