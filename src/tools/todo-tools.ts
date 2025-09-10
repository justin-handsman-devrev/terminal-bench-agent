import { z } from 'zod';
import { BaseTool } from './base-tool';
import { ToolContext, ToolResult } from '../types';
import { TodoManager } from '../core/todo-manager';

export class TodoCreateTool extends BaseTool {
  name = 'todo_create';
  description = 'Create a TODO item with title and optional description and status.';
  parameters = z.object({
    title: z.string(),
    description: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional()
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { title, description, status } = this.validateParams<{ title: string; description?: string; status?: any }>(params);
      const tm = new TodoManager(context.repositoryPath);
      const item = await tm.create(title, description, status);
      return this.createSuccessResult({ item }, `Created TODO: ${item.title}`);
    } catch (error: any) {
      return this.createErrorResult(`Failed to create TODO: ${error.message}`);
    }
  }
}

export class TodoUpdateTool extends BaseTool {
  name = 'todo_update';
  description = 'Update a TODO item by id with fields like title, description, or status.';
  parameters = z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional()
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { id, ...patch } = this.validateParams<any>(params);
      const tm = new TodoManager(context.repositoryPath);
      const item = await tm.update(id, patch);
      if (!item) return this.createErrorResult('TODO not found');
      return this.createSuccessResult({ item }, `Updated TODO: ${item.title}`);
    } catch (error: any) {
      return this.createErrorResult(`Failed to update TODO: ${error.message}`);
    }
  }
}

export class TodoCompleteTool extends BaseTool {
  name = 'todo_complete';
  description = 'Mark a TODO item as completed by id.';
  parameters = z.object({ id: z.string() });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      const { id } = this.validateParams<{ id: string }>(params);
      const tm = new TodoManager(context.repositoryPath);
      const item = await tm.complete(id);
      if (!item) return this.createErrorResult('TODO not found');
      return this.createSuccessResult({ item }, `Completed TODO: ${item.title}`);
    } catch (error: any) {
      return this.createErrorResult(`Failed to complete TODO: ${error.message}`);
    }
  }
}

export class TodoListTool extends BaseTool {
  name = 'todo_list';
  description = 'List all TODO items.';
  parameters = z.object({});

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      const tm = new TodoManager(context.repositoryPath);
      const items = await tm.list();
      return this.createSuccessResult({ items }, `Found ${items.length} TODOs`);
    } catch (error: any) {
      return this.createErrorResult(`Failed to list TODOs: ${error.message}`);
    }
  }
}


