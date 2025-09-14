/**
 * State managers for todo and scratchpad functionality
 */

export interface TodoItem {
  content: string;
  status: 'pending' | 'completed';
}

export class TodoManager {
  private todos: Record<number, TodoItem> = {};
  private nextId: number = 1;

  addTask(content: string): number {
    const taskId = this.nextId;
    this.todos[taskId] = { content, status: 'pending' };
    this.nextId += 1;
    return taskId;
  }

  completeTask(taskId: number): boolean {
    if (taskId in this.todos) {
      this.todos[taskId].status = 'completed';
      return true;
    }
    return false;
  }

  deleteTask(taskId: number): boolean {
    if (taskId in this.todos) {
      delete this.todos[taskId];
      return true;
    }
    return false;
  }

  getTask(taskId: number): TodoItem | null {
    return this.todos[taskId] || null;
  }

  viewAll(): string {
    if (Object.keys(this.todos).length === 0) {
      return 'Todo list is empty.';
    }

    const lines = ['Todo List:'];
    const sortedTodos = Object.entries(this.todos).sort(([a], [b]) => parseInt(a) - parseInt(b));
    
    for (const [taskId, task] of sortedTodos) {
      const statusMarker = task.status === 'completed' ? '[✓]' : '[ ]';
      lines.push(`${statusMarker} [${taskId}] ${task.content}`);
    }

    return lines.join('\n');
  }

  reset(): void {
    this.todos = {};
    this.nextId = 1;
  }
}

export class ScratchpadManager {
  private notes: string[] = [];

  addNote(content: string): number {
    this.notes.push(content);
    return this.notes.length - 1;
  }

  viewAll(): string {
    if (this.notes.length === 0) {
      return 'Scratchpad is empty.';
    }

    const lines = ['Scratchpad Contents:'];
    for (let i = 0; i < this.notes.length; i++) {
      lines.push(`\n--- Note ${i + 1} ---\n${this.notes[i]}`);
    }

    return lines.join('\n');
  }

  reset(): void {
    this.notes = [];
  }
}
