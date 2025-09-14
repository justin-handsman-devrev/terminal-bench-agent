import { z } from 'zod';
import * as yaml from 'js-yaml';
import { 
  ActionSchemas, 
  AnyAction, 
  BashAction,
  BashActionSchema,
  FinishAction,
  FinishActionSchema,
  BatchTodoAction,
  BatchTodoActionSchema,
  ReadAction,
  ReadActionSchema,
  WriteAction,
  WriteActionSchema,
  EditAction,
  EditActionSchema,
  MultiEditAction,
  MultiEditActionSchema,
  FileMetadataAction,
  FileMetadataActionSchema,
  GrepAction,
  GrepActionSchema,
  GlobAction,
  GlobActionSchema,
  LSAction,
  LSActionSchema,
  AddNoteAction,
  AddNoteActionSchema,
  ViewAllNotesAction,
  ViewAllNotesActionSchema,
  TaskCreateAction,
  TaskCreateActionSchema,
  AddContextAction,
  AddContextActionSchema,
  LaunchSubagentAction,
  LaunchSubagentActionSchema,
  ReportAction,
  ReportActionSchema,
  WriteTempScriptAction,
  WriteTempScriptActionSchema,
} from '../entities/actions';

export interface ParseResult {
  actions: AnyAction[];
  errors: string[];
  foundActionAttempt: boolean;
}

export class SimpleActionParser {
  private readonly actionMap: Record<string, z.ZodSchema> = {
    bash: BashActionSchema,
    finish: FinishActionSchema,
    todo: BatchTodoActionSchema,
    task_create: TaskCreateActionSchema,
    add_context: AddContextActionSchema,
    launch_subagent: LaunchSubagentActionSchema,
    report: ReportActionSchema,
    write_temp_script: WriteTempScriptActionSchema,
  };

  private readonly fileActions: Record<string, z.ZodSchema> = {
    read: ReadActionSchema,
    write: WriteActionSchema,
    edit: EditActionSchema,
    multi_edit: MultiEditActionSchema,
    metadata: FileMetadataActionSchema,
  };

  private readonly searchActions: Record<string, z.ZodSchema> = {
    grep: GrepActionSchema,
    glob: GlobActionSchema,
    ls: LSActionSchema,
  };

  private readonly scratchpadActions: Record<string, z.ZodSchema> = {
    add_note: AddNoteActionSchema,
    view_all_notes: ViewAllNotesActionSchema,
  };

  private readonly ignoredTags = new Set(['think', 'reasoning', 'plan_md']);

  parseResponse(response: string): ParseResult {
    const actions: AnyAction[] = [];
    const errors: string[] = [];
    let foundActionAttempt = false;

    const hasXmlAttempts = this.detectXmlAttempts(response);
    if (hasXmlAttempts) {
      foundActionAttempt = true;
    }
    const xmlTags = this.extractXmlTags(response);
    
    if (hasXmlAttempts && xmlTags.length === 0) {
      errors.push('Found XML-like tags but none could be parsed. Ensure opening tags are properly formatted (e.g., <task_create>) and contain valid YAML content.');
    }

    for (const [tagName, content] of xmlTags) {
      if (this.ignoredTags.has(tagName.toLowerCase())) {
        continue;
      }

      foundActionAttempt = true;

      try {
        let data: Record<string, any>;
        try {
          const loaded = yaml.load(content.trim()) as Record<string, any>;
          data = loaded && typeof loaded === 'object' ? loaded : {};
        } catch (yamlError) {
          const sanitized = this.sanitizeYamlContent(content.trim());
          try {
            const loaded = yaml.load(sanitized) as Record<string, any>;
            data = loaded && typeof loaded === 'object' ? loaded : {};
          } catch {
            if (tagName === 'report') {
              const fallback = this.tryParseReportFromXml(content);
              if (fallback) {
                const action = ReportActionSchema.parse(fallback);
                actions.push(action as AnyAction);
                continue;
              }
            }
            throw yamlError;
          }
        }

        const { schema, cleanedData } = this.getActionSchemaAndData(tagName, data);
        
        if (!schema) {
          errors.push(`Unknown action type: ${tagName}`);
          continue;
        }

        const action = schema.parse(cleanedData);
        actions.push(action as AnyAction);

      } catch (error) {
        if (error instanceof yaml.YAMLException) {
          errors.push(`[${tagName}] YAML error: ${error.message}`);
        } else if (error instanceof z.ZodError) {
          const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
          errors.push(`[${tagName}] Validation error: ${errorMessages}`);
        } else {
          errors.push(`[${tagName}] Unexpected error: ${error}`);
        }
      }
    }

    return { actions, errors, foundActionAttempt };
  }

  private detectXmlAttempts(response: string): boolean {
    const openingTagPattern = /<(\w+)>/g;
    const matches = response.match(openingTagPattern);
    
    if (!matches) return false;
    
    return matches.some(match => {
      const tagName = match.slice(1, -1); // Remove < and >
      return !this.ignoredTags.has(tagName.toLowerCase());
    });
  }

  private extractXmlTags(response: string): [string, string][] {
    const properPattern = /(?:^|\n)\s*<(\w+)>([\s\S]*?)<\/\1>/gm;
    const matches: [string, string][] = [];
    let match;

    while ((match = properPattern.exec(response)) !== null) {
      matches.push([match[1], match[2]]);
    }

    if (matches.length > 0) {
      return matches;
    }

    return this.repairAndExtractXmlTags(response);
  }

  private repairAndExtractXmlTags(response: string): [string, string][] {
    const matches: [string, string][] = [];
    
    const openingTagPattern = /(?:^|\n)\s*<(\w+)>([\s\S]*?)(?=\n\s*<\w+>|$)/gm;
    let match;

    while ((match = openingTagPattern.exec(response)) !== null) {
      const tagName = match[1];
      let content = match[2].trim();
      
      if (this.ignoredTags.has(tagName.toLowerCase())) {
        continue;
      }

      content = content.replace(/<\/\w+>\s*$/, '').trim();
      
      matches.push([tagName, content]);
    }

    return matches;
  }

  private getActionSchemaAndData(tagName: string, data: Record<string, any>): {
    schema: z.ZodSchema | null;
    cleanedData: Record<string, any>;
  } {
    const normalizedData = this.normalizeKeys(tagName, { ...data });

    if (this.actionMap[tagName]) {
      return { schema: this.actionMap[tagName], cleanedData: normalizedData };
    }

    if (tagName === 'file') {
      const actionType = normalizedData.action;
      const schema = this.fileActions[actionType];
      if (schema) {
        const { action, ...rest } = normalizedData as any;
        if (actionType === 'multi_edit' && Array.isArray(rest.edits)) {
          rest.edits = rest.edits.map((e: any) => this.normalizeEditKeys(e));
        }
        return { schema, cleanedData: rest };
      }
      return { schema: null, cleanedData: normalizedData };
    }

    if (tagName === 'search') {
      const actionType = normalizedData.action;
      const schema = this.searchActions[actionType];
      if (schema) {
        const { action, ...rest } = normalizedData as any;
        return { schema, cleanedData: rest };
      }
      return { schema: null, cleanedData: normalizedData };
    }

    if (tagName === 'scratchpad') {
      const actionType = normalizedData.action;
      if (actionType === 'add_note') {
        return { 
          schema: AddNoteActionSchema, 
          cleanedData: { content: normalizedData.content || '' } 
        };
      }
      if (actionType === 'view_all_notes') {
        return { schema: ViewAllNotesActionSchema, cleanedData: {} };
      }
      return { schema: null, cleanedData: normalizedData };
    }

    return { schema: null, cleanedData: normalizedData };
  }

  private normalizeKeys(tagName: string, data: Record<string, any>): Record<string, any> {
    if ('file_path' in data) data.filePath = data.file_path;
    if ('filePaths' in data) {
    } else if ('file_paths' in data) data.filePaths = data.file_paths;
    if ('old_string' in data) data.oldString = data.old_string;
    if ('new_string' in data) data.newString = data.new_string;
    if ('replace_all' in data) data.replaceAll = data.replace_all;
    if ('timeout_secs' in data) data.timeoutSecs = data.timeout_secs;
    if ('agent_type' in data) data.agentType = data.agent_type;
    if ('context_refs' in data) data.contextRefs = data.context_refs;
    if ('context_bootstrap' in data) data.contextBootstrap = data.context_bootstrap;
    if ('auto_launch' in data) data.autoLaunch = data.auto_launch;

    // Normalize nested structures
    if (tagName === 'file' && data.action === 'multi_edit' && Array.isArray(data.edits)) {
      data.edits = data.edits.map((e: any) => this.normalizeEditKeys(e));
    }

    return data;
  }

  private normalizeEditKeys(edit: any): any {
    const copy: any = { ...edit };
    if ('old_string' in copy) copy.oldString = copy.old_string;
    if ('new_string' in copy) copy.newString = copy.new_string;
    if ('replace_all' in copy) copy.replaceAll = copy.replace_all;
    return copy;
  }

  private sanitizeYamlContent(content: string): string {
    let sanitized = content;

    sanitized = sanitized.replace(/^(\s*description):\s*(.+)$/gms, (match, key, value) => {
      const trimmedValue = value.trim();
      if (trimmedValue.includes('\n') || trimmedValue.includes(':') || /^\d+\./.test(trimmedValue)) {
        const indentedValue = trimmedValue.replace(/\n/g, '\n  ');
        return `${key}: |\n  ${indentedValue}`;
      }
      return match;
    });

    sanitized = sanitized.replace(/^(\s*content):\s*(.+)$/gms, (match, key, value) => {
      const trimmedValue = value.trim();
      if (trimmedValue.length > 100 || trimmedValue.includes(':') || trimmedValue.includes('\n')) {
        const indentedValue = trimmedValue.replace(/\n/g, '\n    ');
        return `${key}: |\n    ${indentedValue}`;
      }
      return match;
    });

    sanitized = sanitized.replace(/^(\s*comments):\s*(.+)$/gms, (match, key, value) => {
      const trimmedValue = value.trim();
      if (trimmedValue.includes('\n') || trimmedValue.includes(':') || trimmedValue.length > 100) {
        const indentedValue = trimmedValue.replace(/\n/g, '\n  ');
        return `${key}: |\n  ${indentedValue}`;
      }
      return match;
    });

    sanitized = sanitized.replace(/^(\s*oldString):\s*(.+)$/gms, (match, key, value) => {
      const trimmedValue = value.trim();
      if (trimmedValue.startsWith('|') || trimmedValue.match(/^["'].*["']$/)) {
        return match;
      }
      if (trimmedValue.includes('\n') || trimmedValue.includes(':') || trimmedValue.length > 100) {
        const indentedValue = trimmedValue.replace(/\n/g, '\n  ');
        return `${key}: |\n  ${indentedValue}`;
      }
      return match;
    });

    sanitized = sanitized.replace(/^(\s*newString):\s*(.+)$/gms, (match, key, value) => {
      const trimmedValue = value.trim();
      if (trimmedValue.startsWith('|') || trimmedValue.match(/^["'].*["']$/)) {
        return match;
      }
      if (trimmedValue.includes('\n') || trimmedValue.includes(':') || trimmedValue.length > 100) {
        const indentedValue = trimmedValue.replace(/\n/g, '\n  ');
        return `${key}: |\n  ${indentedValue}`;
      }
      return match;
    });

    sanitized = sanitized.replace(/^(\s*\w+):\s*([^"|\n]*:[^"|\n]*?)$/gm, (match, key, value) => {
      if (value.trim().startsWith('|') || value.match(/^["'].*["']$/)) {
        return match;
      }
      if (value.includes(':')) {
        return `${key}: "${value.replace(/"/g, '\\"')}"`;
      }
      return match;
    });

    sanitized = this.convertCmdToBlockScalar(sanitized);

    sanitized = this.fixContentBlockIndentation(sanitized);

    return sanitized;
  }

  private convertCmdToBlockScalar(yamlText: string): string {
    const lines = yamlText.split('\n');
    const result: string[] = [];

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(\s*)cmd\s*:\s*(.*)$/);
      if (!match) {
        result.push(line);
        continue;
      }

      const indent = match[1] ?? '';
      const inlineValue = match[2] ?? '';
      const inlineTrimmed = inlineValue.trim();

      const isAlreadyBlock = inlineTrimmed.startsWith('|') || inlineTrimmed.startsWith('>');
      const isQuotedSingleLine = (
        (inlineTrimmed.startsWith('"') && inlineTrimmed.endsWith('"') && inlineTrimmed.length >= 2) ||
        (inlineTrimmed.startsWith("'") && inlineTrimmed.endsWith("'") && inlineTrimmed.length >= 2)
      );
      const containsColonSpace = /:\s/.test(inlineValue);
      const shouldConvertSingleLine = !isAlreadyBlock && !isQuotedSingleLine && containsColonSpace;
  
      if (!shouldConvertSingleLine && (isAlreadyBlock || isQuotedSingleLine)) {
        result.push(line);
        continue;
      }

      const blockLines: string[] = [];
      if (inlineValue.length > 0) {
        blockLines.push(inlineValue);
      }

      const keyPattern = new RegExp('^' + escapeRegex(indent) + '[A-Za-z_][\\w-]*\\s*:\\s*');
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j];
        if (keyPattern.test(next)) {
          break;
        }
        blockLines.push(next);
      }
      result.push(`${indent}cmd: |`);
      for (const b of blockLines) {
        result.push(`${indent}  ${b}`);
      }

      i = j - 1;
    }

    return result.join('\n');
  }

  private fixContentBlockIndentation(yamlText: string): string {
    const lines = yamlText.split('\n');
    const result: string[] = [];

    const isKeyAtIndent = (line: string, indent: string) => {
      const pattern = new RegExp('^' + indent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[A-Za-z_][\\w-]*\\s*:\\s*(?:\|?>.*)?$');
      return pattern.test(line);
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = line.match(/^(\s*)content\s*:\s*\|\s*$/);
      if (!m) {
        result.push(line);
        continue;
      }

      const indent = m[1] ?? '';
      result.push(line);

      const collected: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const next = lines[j];
        if (isKeyAtIndent(next, indent)) {
          break;
        }
        collected.push(next);
      }

      const needsIndent = collected.some(l => l.trim() !== '' && !l.startsWith(indent + ' '));
      const adjusted = collected.map(l => (l === '' ? indent + '  ' : indent + '  ' + l));

      const finalBlock = needsIndent ? adjusted : collected.map(l => (l === '' ? indent + '  ' : (l.startsWith(indent + '  ') ? l : indent + '  ' + l)));
      for (const b of finalBlock) result.push(b);

      i = j - 1;
    }

    return result.join('\n');
  }

  private tryParseReportFromXml(content: string): { contexts: Array<{ id: string; content: string }>; comments: string } | null {
    try {
      const contexts: Array<{ id: string; content: string }> = [];
      
      // Pattern 1: <context id="..."><content>...</content></context>
      const ctxPattern1 = /<context\s+id=["\']([^"']+)["\'][^>]*>[\s\S]*?<content>([\s\S]*?)<\/content>[\s\S]*?<\/context>/g;
      let match;
      while ((match = ctxPattern1.exec(content)) !== null) {
        const id = match[1];
        const ctxContent = match[2].trim();
        contexts.push({ id, content: ctxContent });
      }

      // Pattern 2: <context><id>...</id><content>...</content></context>
      const ctxPattern2 = /<context[^>]*>[\s\S]*?<id>([^<]+)<\/id>[\s\S]*?<content>([\s\S]*?)<\/content>[\s\S]*?<\/context>/g;
      while ((match = ctxPattern2.exec(content)) !== null) {
        const id = match[1].trim();
        const ctxContent = match[2].trim();
        contexts.push({ id, content: ctxContent });
      }

      // Pattern 3: Simple nested structure without attributes
      const ctxPattern3 = /<context>\s*<id>([^<]+)<\/id>\s*<content>([\s\S]*?)<\/content>\s*<\/context>/g;
      while ((match = ctxPattern3.exec(content)) !== null) {
        const id = match[1].trim();
        const ctxContent = match[2].trim();
        contexts.push({ id, content: ctxContent });
      }

      // Extract comments: <comments>...</comments>
      let comments = '';
      const commentsMatch = content.match(/<comments>([\s\S]*?)<\/comments>/);
      if (commentsMatch) {
        comments = commentsMatch[1].trim();
      }

      // Also try to extract plain text after contexts if no explicit comments tag
      if (!comments && contexts.length > 0) {
        const lastContextEnd = content.lastIndexOf('</context>');
        if (lastContextEnd !== -1) {
          const afterContexts = content.substring(lastContextEnd + '</context>'.length).trim();
          const cleanedComments = afterContexts.replace(/<[^>]*>/g, '').trim();
          if (cleanedComments) {
            comments = cleanedComments;
          }
        }
      }

      if (contexts.length === 0 && !comments) {
        return null;
      }

      return { contexts, comments };
    } catch {
      return null;
    }
  }
}

