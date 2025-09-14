import winston from 'winston';
import { CommandExecutor } from '../../../core/execution/command-executor';
import { OrchestratorHub } from '../orchestrator-hub';
import { TodoManager, ScratchpadManager } from '../state-managers';
import { FileManager } from '../file-manager';
import { SearchManager } from '../search-manager';
import {
  AnyAction,
  BashAction,
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
  TaskCreateAction,
  AddContextAction,
  LaunchSubagentAction,
  ReportAction,
  WriteTempScriptAction,
  isBashAction,
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
  isTaskCreateAction,
  isAddContextAction,
  isLaunchSubagentAction,
  isReportAction,
  isWriteTempScriptAction,
} from '../entities/actions';
import { AgentConfig } from '../../../types';

export function formatToolOutput(toolName: string, content: string): string {
  const tagName = `${toolName}_output`;
  return `<${tagName}>\n${content}\n</${tagName}>`;
}

export interface ActionHandlerConfig extends AgentConfig {
  loggingDir?: string;
}

export class ActionHandler {
  private fileManager: FileManager;
  private searchManager: SearchManager;
  private subagentTrajectories: Record<string, Record<string, any>> = {};

  constructor(
    private executor: CommandExecutor,
    private todoManager: TodoManager = new TodoManager(),
    private scratchpadManager: ScratchpadManager = new ScratchpadManager(),
    private orchestratorHub: OrchestratorHub = new OrchestratorHub(),
    private config: ActionHandlerConfig = {}
  ) {
    this.fileManager = new FileManager(executor);
    this.searchManager = new SearchManager(executor);
  }

  private static truncateContent(content: string, maxLength: number = 15): string {
    return content.length > maxLength ? content.slice(0, maxLength) + '...' : content;
  }

  async handleAction(action: AnyAction): Promise<[string, boolean]> {
    try {
      if (isBashAction(action)) {
        return await this.handleBash(action as BashAction);
      } else if (isFinishAction(action)) {
        return await this.handleFinish(action as FinishAction);
      } else if (isBatchTodoAction(action)) {
        return await this.handleBatchTodo(action as BatchTodoAction);
      } else if (isReadAction(action)) {
        return await this.handleReadFile(action as ReadAction);
      } else if (isWriteAction(action)) {
        return await this.handleWriteFile(action as WriteAction);
      } else if (isEditAction(action)) {
        return await this.handleEditFile(action as EditAction);
      } else if (isMultiEditAction(action)) {
        return await this.handleMultiEditFile(action as MultiEditAction);
      } else if (isFileMetadataAction(action)) {
        return await this.handleFileMetadata(action as FileMetadataAction);
      } else if (isGrepAction(action)) {
        return await this.handleGrep(action as GrepAction);
      } else if (isGlobAction(action)) {
        return await this.handleGlob(action as GlobAction);
      } else if (isLSAction(action)) {
        return await this.handleLS(action as LSAction);
      } else if (isAddNoteAction(action)) {
        return await this.handleAddNote(action as AddNoteAction);
      } else if (isViewAllNotesAction(action)) {
        return await this.handleViewAllNotes(action as ViewAllNotesAction);
      } else if (isTaskCreateAction(action)) {
        return await this.handleTaskCreate(action as TaskCreateAction);
      } else if (isAddContextAction(action)) {
        return await this.handleAddContext(action as AddContextAction);
      } else if (isLaunchSubagentAction(action)) {
        return await this.handleLaunchSubagent(action as LaunchSubagentAction);
      } else if (isReportAction(action)) {
        return await this.handleReport(action as ReportAction);
      } else if (isWriteTempScriptAction(action)) {
        return await this.handleWriteTempScript(action as WriteTempScriptAction);
      }

      const content = `[ERROR] Unknown action type: ${typeof action}`;
      return [formatToolOutput('unknown', content), true];
    } catch (error) {
      const content = `[ERROR] Action execution failed: ${error}`;
      return [formatToolOutput('error', content), true];
    }
  }

  private async handleBash(action: BashAction): Promise<[string, boolean]> {
    try {
      let output: string;
      let exitCode: number;

      if (action.block) {
        const result = await this.executor.execute(action.cmd, action.timeoutSecs);
        output = result.output;
        exitCode = result.exitCode;

        if (exitCode !== 0 && output.includes('command not found')) {
          const fallbackResult = await this.tryCommandFallbacks(action.cmd, action.timeoutSecs);
          if (fallbackResult) {
            output = fallbackResult.output;
            exitCode = fallbackResult.exitCode;
          }
        }
      } else {

        await this.executor.executeBackground(action.cmd);
        output = 'Command started in background';
        exitCode = 0;
      }

      const isError = exitCode !== 0;
      return [formatToolOutput('bash', output), isError];

    } catch (error) {
      const errorMsg = `Error executing command: ${error}`;
      return [formatToolOutput('bash', errorMsg), true];
    }
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

    // Fallback for file command
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
          // ignore
        }
      }
    }

    // Fallback for hexdump
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
          // ignore
        }
      }
    }

    return null;
  }

  private async handleFinish(action: FinishAction): Promise<[string, boolean]> {
    const response = `Task marked as complete: ${action.message}`;
    return [formatToolOutput('finish', response), false];
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
    return [formatToolOutput('file', content), isError];
  }

  private async handleEditFile(action: EditAction): Promise<[string, boolean]> {
    const [content, isError] = await this.fileManager.editFile(
      action.filePath,
      action.oldString,
      action.newString,
      action.replaceAll
    );
    return [formatToolOutput('file', content), isError];
  }

  private async handleMultiEditFile(action: MultiEditAction): Promise<[string, boolean]> {
    const edits = action.edits.map(e => ({
      oldString: e.oldString,
      newString: e.newString,
      replaceAll: e.replaceAll || false,
    }));
    const [content, isError] = await this.fileManager.multiEditFile(action.filePath, edits);
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
        action.agentType as any, // Type assertion for enum compatibility
        action.title,
        action.description,
        action.contextRefs,
        action.contextBootstrap
      );

      let response = `Created task ${taskId}: ${action.title}`;

      // Auto-launch if requested
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

  getAndClearSubagentTrajectories(): Record<string, Record<string, any>> {
    const trajectories = { ...this.subagentTrajectories };
    this.subagentTrajectories = {};
    return trajectories;
  }
}
