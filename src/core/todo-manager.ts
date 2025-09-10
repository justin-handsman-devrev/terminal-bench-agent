import * as fs from 'fs-extra';
import * as path from 'path';
import { nanoid } from 'nanoid';
import { TodoItem, TodoListResponse, TodoStatus } from '../types';

export class TodoManager {
  private storagePath: string;

  constructor(repositoryPath: string) {
    this.storagePath = path.join(repositoryPath, '.devrev-todos.json');
  }

  private async readTodos(): Promise<TodoItem[]> {
    try {
      if (!(await fs.pathExists(this.storagePath))) return [];
      const raw = await fs.readFile(this.storagePath, 'utf-8');
      const parsed = JSON.parse(raw) as TodoListResponse;
      return parsed.items || [];
    } catch {
      return [];
    }
  }

  private async writeTodos(items: TodoItem[]): Promise<void> {
    const payload: TodoListResponse = { items };
    await fs.writeFile(this.storagePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  async list(): Promise<TodoItem[]> {
    return this.readTodos();
  }

  async create(title: string, description?: string, status: TodoStatus = 'pending'): Promise<TodoItem> {
    const items = await this.readTodos();
    const now = new Date().toISOString();
    const item: TodoItem = {
      id: nanoid(),
      title,
      description,
      status,
      createdAt: now,
      updatedAt: now
    };
    items.push(item);
    await this.writeTodos(items);
    return item;
  }

  async update(id: string, patch: Partial<Omit<TodoItem, 'id' | 'createdAt'>>): Promise<TodoItem | null> {
    const items = await this.readTodos();
    const idx = items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    items[idx] = { ...items[idx], ...patch, updatedAt: now } as TodoItem;
    await this.writeTodos(items);
    return items[idx];
  }

  async complete(id: string): Promise<TodoItem | null> {
    return this.update(id, { status: 'completed' });
  }
}


