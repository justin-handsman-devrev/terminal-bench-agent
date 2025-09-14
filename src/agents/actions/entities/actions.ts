// =============================================================================
/**
 * Action Definitions Module
 * =======================
 * 
 * This module defines all possible actions that can be performed by agents using
 * Zod schemas for automatic validation (TypeScript equivalent of Pydantic).
 * 
 * Key Components:
 * - Action schemas with validation rules
 * - TypeScript type definitions
 * - Type guard functions for runtime type checking
 * 
 * Usage:
 * import { ActionType, ActionSchemas, isEditAction } from './actions';
 */
// =============================================================================

import { z } from 'zod';

// -----------------------------------------------------------------------------
/**
 * Base Action Schema
 * -----------------
 * Foundation for all other action schemas. Currently empty but serves as
 * a base for potential common fields in the future.
 */
export const ActionSchema = z.object({}).strict();

export type Action = z.infer<typeof ActionSchema>;

// -----------------------------------------------------------------------------
/**
 * Bash Action Schema
 * -----------------
 * Defines the structure for executing shell commands.
 * 
 * Fields:
 * - cmd: The shell command to execute
 * - block: Whether to wait for command completion (default: true)
 * - timeoutSecs: Maximum execution time in seconds (default: 60, max: 300)
 */
export const BashActionSchema = z.object({
  cmd: z.string().min(1, 'Command cannot be empty'),
  block: z.boolean().default(true),
  timeoutSecs: z.number().int().positive().max(300).default(60),
}).strict();

export type BashAction = z.infer<typeof BashActionSchema>;

// -----------------------------------------------------------------------------
/**
 * Finish Action Schema
 * ------------------
 * Signals completion of a task or operation with an optional message.
 */
export const FinishActionSchema = z.object({
  message: z.string().default('Task completed'),
}).strict();

export type FinishAction = z.infer<typeof FinishActionSchema>;

// -----------------------------------------------------------------------------
/**
 * Todo Operations Schema
 * --------------------
 * Defines operations that can be performed on todo items.
 * 
 * Operations:
 * - add: Create a new todo item (requires content)
 * - complete: Mark a todo as done (requires taskId)
 * - delete: Remove a todo item (requires taskId)
 * - view_all: List all todo items
 * 
 * Note: The schema includes runtime validation to ensure required fields
 * are present based on the operation type.
 */
export const TodoOperationSchema = z.object({
  action: z.enum(['add', 'complete', 'delete', 'view_all']),
  content: z.string().optional(),
  taskId: z.number().int().positive().optional(),
}).strict().refine((data) => {
  if (data.action === 'add' && !data.content) {
    throw new Error("'add' action requires 'content'");
  }
  if ((data.action === 'complete' || data.action === 'delete') && !data.taskId) {
    throw new Error(`'${data.action}' action requires taskId`);
  }
  return true;
});

export type TodoOperation = z.infer<typeof TodoOperationSchema>;

export const BatchTodoActionSchema = z.object({
  operations: z.array(TodoOperationSchema).min(1),
  viewAll: z.boolean().default(false),
}).strict();

export type BatchTodoAction = z.infer<typeof BatchTodoActionSchema>;

// =============================================================================
/**
 * File Operation Actions
 * ====================
 * Collection of schemas for file system operations including reading,
 * writing, and editing files.
 */
// -----------------------------------------------------------------------------
/**
 * Read Action Schema
 * ----------------
 * Reads content from a file with optional pagination support.
 * 
 * Fields:
 * - filePath: Path to the file to read
 * - offset: Starting line number (optional)
 * - limit: Maximum number of lines to read (optional)
 */
export const ReadActionSchema = z.object({
  filePath: z.string().min(1),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
}).strict();

export type ReadAction = z.infer<typeof ReadActionSchema>;

export const WriteActionSchema = z.object({
  filePath: z.string().min(1),
  content: z.string(),
}).strict();

export type WriteAction = z.infer<typeof WriteActionSchema>;

export const EditActionSchema = z.object({
  filePath: z.string().min(1),
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().default(false),
}).strict();

export type EditAction = z.infer<typeof EditActionSchema>;

export const EditOperationSchema = z.object({
  oldString: z.string(),
  newString: z.string(),
  replaceAll: z.boolean().default(false),
}).strict();

export type EditOperation = z.infer<typeof EditOperationSchema>;

export const MultiEditActionSchema = z.object({
  filePath: z.string().min(1),
  edits: z.array(EditOperationSchema).min(1),
}).strict();

export type MultiEditAction = z.infer<typeof MultiEditActionSchema>;

export const FileMetadataActionSchema = z.object({
  filePaths: z.array(z.string()).min(1).max(10),
}).strict();

export type FileMetadataAction = z.infer<typeof FileMetadataActionSchema>;

// =============================================================================
/**
 * Search Actions
 * =============
 * Collection of schemas for searching and listing files in the workspace.
 * Includes pattern matching, glob-based searches, and directory listing.
 */
// -----------------------------------------------------------------------------
/**
 * Grep Action Schema
 * ----------------
 * Text-based search within files using regular expressions.
 * 
 * Fields:
 * - pattern: Regular expression pattern to search for
 * - path: Directory or file to search in (optional)
 * - include: File pattern to filter search (e.g., "*.ts") (optional)
 */
export const GrepActionSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  include: z.string().optional(),
}).strict();

export type GrepAction = z.infer<typeof GrepActionSchema>;

export const GlobActionSchema = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
}).strict();

export type GlobAction = z.infer<typeof GlobActionSchema>;

export const LSActionSchema = z.object({
  path: z.string().min(1),
  ignore: z.array(z.string()).default([]),
}).strict();

export type LSAction = z.infer<typeof LSActionSchema>;

// Scratchpad Actions
export const AddNoteActionSchema = z.object({
  content: z.string().min(1),
}).strict();

export type AddNoteAction = z.infer<typeof AddNoteActionSchema>;

export const ViewAllNotesActionSchema = z.object({}).strict();

export type ViewAllNotesAction = z.infer<typeof ViewAllNotesActionSchema>;

// =============================================================================
/**
 * Task Management Actions
 * =====================
 * Collection of schemas for managing tasks, subagents, and context tracking.
 * These actions handle task creation, context management, and agent coordination.
 */
// -----------------------------------------------------------------------------
/**
 * Task Create Action Schema
 * -----------------------
 * Creates a new task for execution by a specific agent type.
 * 
 * Fields:
 * - agentType: Type of agent to handle the task ('explorer' or 'coder')
 * - title: Short task description
 * - description: Detailed task requirements
 * - contextRefs: References to relevant context IDs
 * - contextBootstrap: Initial file context with reasoning
 * - autoLaunch: Whether to start the task immediately
 */
export const TaskCreateActionSchema = z.object({
  agentType: z.enum(['explorer', 'coder']),
  title: z.string().min(1),
  description: z.string().min(1),
  contextRefs: z.array(z.string()).default([]),
  contextBootstrap: z.array(z.object({
    path: z.string(),
    reason: z.string(),
  })).default([]),
  autoLaunch: z.boolean().default(false),
}).strict();

export type TaskCreateAction = z.infer<typeof TaskCreateActionSchema>;

export const AddContextActionSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  reportedBy: z.string().default('?'),
  taskId: z.string().optional(),
}).strict();

export type AddContextAction = z.infer<typeof AddContextActionSchema>;

export const LaunchSubagentActionSchema = z.object({
  taskId: z.string().min(1),
}).strict();

export type LaunchSubagentAction = z.infer<typeof LaunchSubagentActionSchema>;

export const ReportActionSchema = z.object({
  contexts: z.array(z.object({
    id: z.string(),
    content: z.string(),
  })).default([]),
  comments: z.string().default(''),
}).strict();

export type ReportAction = z.infer<typeof ReportActionSchema>;

export const WriteTempScriptActionSchema = z.object({
  filePath: z.string().min(1),
  content: z.string(),
}).strict();

export type WriteTempScriptAction = z.infer<typeof WriteTempScriptActionSchema>;

// Union type for all actions
export type AnyAction = 
  | BashAction
  | FinishAction
  | BatchTodoAction
  | ReadAction
  | WriteAction
  | EditAction
  | MultiEditAction
  | FileMetadataAction
  | GrepAction
  | GlobAction
  | LSAction
  | AddNoteAction
  | ViewAllNotesAction
  | TaskCreateAction
  | AddContextAction
  | LaunchSubagentAction
  | ReportAction
  | WriteTempScriptAction;

// Action type mapping for parser
export const ActionSchemas = {
  bash: BashActionSchema,
  finish: FinishActionSchema,
  todo: BatchTodoActionSchema,
  read: ReadActionSchema,
  write: WriteActionSchema,
  edit: EditActionSchema,
  multiEdit: MultiEditActionSchema,
  metadata: FileMetadataActionSchema,
  grep: GrepActionSchema,
  glob: GlobActionSchema,
  ls: LSActionSchema,
  addNote: AddNoteActionSchema,
  viewAllNotes: ViewAllNotesActionSchema,
  taskCreate: TaskCreateActionSchema,
  addContext: AddContextActionSchema,
  launchSubagent: LaunchSubagentActionSchema,
  report: ReportActionSchema,
  writeTempScript: WriteTempScriptActionSchema,
} as const;

export type ActionType = keyof typeof ActionSchemas;

// =============================================================================
/**
 * Type Guard Functions
 * ==================
 * Collection of type guard functions for runtime type checking of actions.
 * Each function validates if a given object matches a specific action schema.
 * 
 * Usage:
 * ```typescript
 * if (isBashAction(action)) {
 *   // TypeScript knows action is BashAction here
 *   console.log(action.cmd);
 * }
 * ```
 */
// -----------------------------------------------------------------------------
export function isBashAction(action: any): action is BashAction {
  return BashActionSchema.safeParse(action).success;
}

export function isFinishAction(action: any): action is FinishAction {
  return FinishActionSchema.safeParse(action).success;
}

export function isBatchTodoAction(action: any): action is BatchTodoAction {
  return BatchTodoActionSchema.safeParse(action).success;
}

export function isReadAction(action: any): action is ReadAction {
  return ReadActionSchema.safeParse(action).success;
}

export function isWriteAction(action: any): action is WriteAction {
  return WriteActionSchema.safeParse(action).success;
}

export function isEditAction(action: any): action is EditAction {
  return EditActionSchema.safeParse(action).success;
}

export function isMultiEditAction(action: any): action is MultiEditAction {
  return MultiEditActionSchema.safeParse(action).success;
}

export function isFileMetadataAction(action: any): action is FileMetadataAction {
  return FileMetadataActionSchema.safeParse(action).success;
}

export function isGrepAction(action: any): action is GrepAction {
  return GrepActionSchema.safeParse(action).success;
}

export function isGlobAction(action: any): action is GlobAction {
  return GlobActionSchema.safeParse(action).success;
}

export function isLSAction(action: any): action is LSAction {
  return LSActionSchema.safeParse(action).success;
}

export function isAddNoteAction(action: any): action is AddNoteAction {
  return AddNoteActionSchema.safeParse(action).success;
}

export function isViewAllNotesAction(action: any): action is ViewAllNotesAction {
  return ViewAllNotesActionSchema.safeParse(action).success;
}

export function isTaskCreateAction(action: any): action is TaskCreateAction {
  return TaskCreateActionSchema.safeParse(action).success;
}

export function isAddContextAction(action: any): action is AddContextAction {
  return AddContextActionSchema.safeParse(action).success;
}

export function isLaunchSubagentAction(action: any): action is LaunchSubagentAction {
  return LaunchSubagentActionSchema.safeParse(action).success;
}

export function isReportAction(action: any): action is ReportAction {
  return ReportActionSchema.safeParse(action).success;
}

export function isWriteTempScriptAction(action: any): action is WriteTempScriptAction {
  return WriteTempScriptActionSchema.safeParse(action).success;
}
