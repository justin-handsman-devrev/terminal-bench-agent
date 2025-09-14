import { Task, TaskStatus, Context, ContextBootstrapItem, SubagentReport, AgentType } from '../../types';
import winston from 'winston';

export class OrchestratorHub {
  private tasks: Record<string, Task> = {};
  private contextStore: Record<string, Context> = {};
  private taskCounter: number = 0;

  createTask(
    agentType: AgentType,
    title: string,
    description: string,
    contextRefs: string[],
    contextBootstrap: Array<{ path: string; reason: string }>
  ): string {
    this.taskCounter += 1;
    const taskId = `task_${this.taskCounter.toString().padStart(3, '0')}`;

    const bootstrapItems: ContextBootstrapItem[] = contextBootstrap.map(item => ({
      path: item.path,
      reason: item.reason,
    }));

    const task: Task = {
      taskId,
      agentType,
      title,
      description,
      contextRefs,
      contextBootstrap: bootstrapItems,
      status: TaskStatus.CREATED,
      createdAt: new Date().toISOString(),
    };

    this.tasks[taskId] = task;
    winston.info(`Task created: ${taskId} - ${title}`);

    return taskId;
  }

  getTask(taskId: string): Task | null {
    return this.tasks[taskId] || null;
  }

  updateTaskStatus(taskId: string, status: TaskStatus): boolean {
    const task = this.tasks[taskId];
    if (!task) {
      winston.warn(`Task ${taskId} not found`);
      return false;
    }

    task.status = status;
    if (status === TaskStatus.COMPLETED) {
      task.completedAt = new Date().toISOString();
    }

    winston.info(`Task updated: ${taskId} - Status: ${status}`);
    return true;
  }

  viewAllTasks(): string {
    if (Object.keys(this.tasks).length === 0) {
      return 'No tasks created yet.';
    }

    const lines = ['Tasks:'];
    for (const [taskId, task] of Object.entries(this.tasks)) {
      const statusSymbol = {
        [TaskStatus.CREATED]: '○',
        [TaskStatus.COMPLETED]: '●',
        [TaskStatus.FAILED]: '✗',
      }[task.status] || '?';

      lines.push(`  ${statusSymbol} [${taskId}] ${task.title} (${task.agentType})`);
      lines.push(`      Status: ${task.status}`);

      if (task.contextRefs.length > 0) {
        lines.push(`      Context refs: ${task.contextRefs.join(', ')}`);
      }

      if (task.contextBootstrap.length > 0) {
        const bootstrapStr = task.contextBootstrap.map(item => item.path).join(', ');
        lines.push(`      Bootstrap: ${bootstrapStr}`);
      }

      if (task.result) {
        lines.push(`      Result: ${JSON.stringify(task.result)}`);
      }
      if (task.completedAt) {
        lines.push(`      Completed at: ${task.completedAt}`);
      }
    }

    return lines.join('\n');
  }

  addContext(
    contextId: string,
    content: string,
    reportedBy: string,
    taskId?: string
  ): boolean {
    if (this.contextStore[contextId]) {
      winston.warn(`Context ${contextId} already exists`);
      return false;
    }

    const context: Context = {
      id: contextId,
      content,
      reportedBy,
      taskId,
      createdAt: new Date().toISOString(),
    };

    this.contextStore[contextId] = context;
    winston.info(`Context added: ${contextId}`);
    return true;
  }

  getContextsForTask(contextRefs: string[]): Record<string, string> {
    const contexts: Record<string, string> = {};
    for (const ref of contextRefs) {
      const context = this.contextStore[ref];
      if (context) {
        contexts[ref] = context.content;
      } else {
        winston.warn(`Context ${ref} not found`);
      }
    }
    return contexts;
  }

  viewContextStore(): string {
    if (Object.keys(this.contextStore).length === 0) {
      return 'Context store is empty.';
    }

    const lines = ['Context Store:'];
    for (const [contextId, context] of Object.entries(this.contextStore)) {
      lines.push(`  Id: [${contextId}]`);
      lines.push(`     Content: ${context.content}`);
      lines.push(`     Reported by: ${context.reportedBy}`);

      if (context.taskId) {
        lines.push(`    Task: ${context.taskId}`);
      }
    }

    return lines.join('\n');
  }

  processSubagentResult(taskId: string, report: SubagentReport): Record<string, any> {
    const storedContextIds: string[] = [];

    for (const ctx of report.contexts) {
      if (ctx.id && ctx.content) {
        const success = this.addContext(
          ctx.id,
          ctx.content,
          taskId,
          taskId
        );

        if (success) {
          storedContextIds.push(ctx.id);
        } else {
          winston.warn(`Context ${ctx.id} already exists, skipping`);
        }
      }
    }

    const result = {
      taskId,
      contextIdsStored: storedContextIds,
      comments: report.comments,
    };

    const task = this.getTask(taskId);
    if (task) {
      task.result = result;
      this.updateTaskStatus(taskId, TaskStatus.COMPLETED);
    }

    return result;
  }

  getTasks(): Record<string, Task> {
    return { ...this.tasks };
  }

  getContextStore(): Record<string, Context> {
    return { ...this.contextStore };
  }
}
