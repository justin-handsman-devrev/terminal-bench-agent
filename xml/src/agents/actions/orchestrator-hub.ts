import { Task, TaskStatus, Context, ContextBootstrapItem, SubagentReport, AgentType } from '../../types';
import winston from 'winston';

interface ContextMetadata {
  relevance: number;
  lastUsed: Date;
  usageCount: number;
  relatedContexts: string[];
  tags: string[];
  size: number;
}

interface EnhancedContext extends Context {
  metadata: ContextMetadata;
}

export class OrchestratorHub {
  private tasks: Record<string, Task> = {};
  private contextStore: Record<string, EnhancedContext> = {};
  private contextMetadata: Record<string, ContextMetadata> = {};
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
      if (this.contextStore[contextId].metadata) {
        this.contextStore[contextId].metadata.usageCount++;
        this.contextStore[contextId].metadata.lastUsed = new Date();
      }
      return false;
    }

    const tags = this.extractTags(contextId, content);
    
    const context: EnhancedContext = {
      id: contextId,
      content,
      reportedBy,
      taskId,
      createdAt: new Date().toISOString(),
      metadata: {
        relevance: 1.0,
        lastUsed: new Date(),
        usageCount: 1,
        relatedContexts: [],
        tags,
        size: content.length,
      }
    };

    this.contextStore[contextId] = context;
    
    this.updateRelatedContexts(contextId, content);
    
    winston.info(`Context added: ${contextId} with tags: ${tags.join(', ')}`);
    return true;
  }

  private extractTags(contextId: string, content: string): string[] {
    const tags: string[] = [];
    if (contextId.includes('error')) tags.push('error');
    if (contextId.includes('config')) tags.push('configuration');
    if (contextId.includes('test')) tags.push('testing');
    if (contextId.includes('impl')) tags.push('implementation');
    if (contextId.includes('fix')) tags.push('bugfix');
    if (content.includes('function') || content.includes('class')) tags.push('code');
    if (content.includes('package.json')) tags.push('nodejs');
    if (content.includes('import') || content.includes('export')) tags.push('module');
    if (content.includes('TODO') || content.includes('FIXME')) tags.push('needs-work');
    return tags;
  }

  private updateRelatedContexts(newContextId: string, newContent: string): void {
    const keywords = newContent.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    for (const [existingId, existingContext] of Object.entries(this.contextStore)) {
      if (existingId === newContextId) continue;
      const existingKeywords = existingContext.content.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const commonKeywords = keywords.filter(k => existingKeywords.includes(k));
      if (commonKeywords.length > keywords.length * 0.2) {
        if (!existingContext.metadata.relatedContexts.includes(newContextId)) {
          existingContext.metadata.relatedContexts.push(newContextId);
        }
        if (!this.contextStore[newContextId].metadata.relatedContexts.includes(existingId)) {
          this.contextStore[newContextId].metadata.relatedContexts.push(existingId);
        }
      }
    }
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
    const simplified: Record<string, Context> = {};
    for (const [id, enhancedContext] of Object.entries(this.contextStore)) {
      simplified[id] = {
        id: enhancedContext.id,
        content: enhancedContext.content,
        reportedBy: enhancedContext.reportedBy,
        taskId: enhancedContext.taskId,
        createdAt: enhancedContext.createdAt,
      };
    }
    return simplified;
  }

  findContextsByQuery(query: string, limit: number = 5): Array<{ context: Context; score: number }> {
    const results: Array<{ context: Context; score: number }> = [];
    const queryLower = query.toLowerCase();
    const queryKeywords = queryLower.split(/\s+/).filter(w => w.length > 2);
    for (const [id, context] of Object.entries(this.contextStore)) {
      let score = 0;
      if (id.toLowerCase().includes(queryLower)) {
        score += 5;
      }
      const contentLower = context.content.toLowerCase();
      for (const keyword of queryKeywords) {
        if (contentLower.includes(keyword)) {
          score += 2;
        }
      }
      if (context.metadata) {
        for (const tag of context.metadata.tags) {
          if (queryKeywords.some(k => tag.includes(k))) {
            score += 3;
          }
        }
        const hoursSinceUsed = (Date.now() - context.metadata.lastUsed.getTime()) / (1000 * 60 * 60);
        if (hoursSinceUsed < 1) score += 2;
        else if (hoursSinceUsed < 24) score += 1;
        score += Math.min(context.metadata.usageCount * 0.5, 3);
      }
      if (score > 0) {
        results.push({ 
          context: {
            id: context.id,
            content: context.content,
            reportedBy: context.reportedBy,
            taskId: context.taskId,
            createdAt: context.createdAt,
          }, 
          score 
        });
      }
    }
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getContextsByTags(tags: string[]): Context[] {
    const results: Context[] = [];
    for (const context of Object.values(this.contextStore)) {
      if (context.metadata && tags.some(tag => context.metadata.tags.includes(tag))) {
        results.push({
          id: context.id,
          content: context.content,
          reportedBy: context.reportedBy,
          taskId: context.taskId,
          createdAt: context.createdAt,
        });
      }
    }
    return results;
  }

  getRelatedContexts(contextId: string): Context[] {
    const context = this.contextStore[contextId];
    if (!context || !context.metadata) return [];
    return context.metadata.relatedContexts
      .map(relatedId => this.contextStore[relatedId])
      .filter(c => c)
      .map(c => ({
        id: c.id,
        content: c.content,
        reportedBy: c.reportedBy,
        taskId: c.taskId,
        createdAt: c.createdAt,
      }));
  }
}
