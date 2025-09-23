import { z } from 'zod';
import * as yaml from 'js-yaml';
import { YamlErrorRecovery } from './yaml-error-recovery';
import { 
  AnyAction, 
  BashActionSchema,
  BatchBashActionSchema,
  FinishActionSchema,
  BatchTodoActionSchema,
  ReadActionSchema,
  WriteActionSchema,
  EditActionSchema,
  MultiEditActionSchema,
  FileMetadataActionSchema,
  GrepActionSchema,
  GlobActionSchema,
  LSActionSchema,
  AddNoteActionSchema,
  ViewAllNotesActionSchema,
  ViewMetricsActionSchema,
  ContextAnalysisActionSchema,
  ViewValidationCacheActionSchema,
  CoordinateAgentsActionSchema,
  TaskCreateActionSchema,
  AddContextActionSchema,
  LaunchSubagentActionSchema,
  ReportActionSchema,
  WriteTempScriptActionSchema,
  TestCompileActionSchema,
  VerifyCompatibilityActionSchema,
} from '../entities/actions';

export interface ParseResult {
  actions: AnyAction[];
  errors: string[];
  foundActionAttempt: boolean;
}

export class SimpleActionParser {
  private readonly actionMap: Record<string, z.ZodSchema> = {
    bash: BashActionSchema,
    batch_bash: BatchBashActionSchema,
    finish: FinishActionSchema,
    todo: BatchTodoActionSchema,
    task_create: TaskCreateActionSchema,
    add_context: AddContextActionSchema,
    launch_subagent: LaunchSubagentActionSchema,
    report: ReportActionSchema,
    write_temp_script: WriteTempScriptActionSchema,
    test_compile: TestCompileActionSchema,
    verify_compatibility: VerifyCompatibilityActionSchema,
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
    view_metrics: ViewMetricsActionSchema,
    context_analysis: ContextAnalysisActionSchema,
    view_validation_cache: ViewValidationCacheActionSchema,
    coordinate_agents: CoordinateAgentsActionSchema,
  };

  private readonly ignoredTags = new Set(['think', 'reasoning', 'plan_md']);

  async parseResponse(response: string): Promise<ParseResult> {
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
        let recoveryInfo: string | undefined;
        
        // First, try standard parsing
        try {
          const loaded = yaml.load(content.trim()) as Record<string, any>;
          data = loaded && typeof loaded === 'object' ? loaded : {};
        } catch (yamlError) {
          // Try recovery before sanitization
          const recoveryResult = await YamlErrorRecovery.tryRecover(content.trim(), yamlError as yaml.YAMLException);
          
          if (recoveryResult.success) {
            data = recoveryResult.data;
            recoveryInfo = recoveryResult.suggestion;
          } else {
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
              
              // Use recovery suggestion if available
              if (recoveryResult.suggestion) {
                errors.push(`[${tagName}] YAML parsing failed. ${recoveryResult.suggestion}`);
                continue;
              }
              
              throw yamlError;
            }
          }
        }

       
        const decodedData = this.decodeHtmlEntitiesInObject(data);
        const { schema, cleanedData } = this.getActionSchemaAndData(tagName, decodedData);
        
        if (!schema) {
          errors.push(`Unknown action type: ${tagName}`);
          continue;
        }

        const action = schema.parse(cleanedData);
        actions.push(action as AnyAction);

        } catch (error) {
          if (error instanceof yaml.YAMLException) {
            const yamlHelp = await this.getYamlErrorHelp(tagName, content, error);
            errors.push(`[${tagName}] YAML error: ${error.message}\n${yamlHelp}`);
          } else if (error instanceof z.ZodError) {
            const errorMessages = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
            const zodHelp = this.getZodErrorHelp(tagName, error);
            errors.push(`[${tagName}] Validation error: ${errorMessages}\n${zodHelp}`);
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

   
    if (Object.prototype.hasOwnProperty.call(this.fileActions, tagName)) {
      const schema = this.fileActions[tagName];
      const cleaned = this.normalizeKeys('file', { ...data });
      if (tagName === 'multi_edit' && Array.isArray((cleaned as any).edits)) {
        (cleaned as any).edits = (cleaned as any).edits.map((e: any) => this.normalizeEditKeys(e));
      }
      return { schema, cleanedData: cleaned };
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

   
    if (Object.prototype.hasOwnProperty.call(this.searchActions, tagName)) {
      const schema = this.searchActions[tagName];
      const cleaned = this.normalizeKeys('search', { ...data });
      return { schema, cleanedData: cleaned };
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

   
    sanitized = sanitized
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'");

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
      const containsMultilineIndicators = /[\n\r]/.test(inlineValue) || inlineValue.includes('\\n');
      const shouldConvertSingleLine = !isAlreadyBlock && !isQuotedSingleLine && (containsColonSpace || containsMultilineIndicators);
  
      if (!shouldConvertSingleLine && (isAlreadyBlock || isQuotedSingleLine)) {
        result.push(line);
        continue;
      }

      const blockLines: string[] = [];
      if (inlineValue.length > 0) {
        const processedValue = inlineValue.replace(/\\n/g, '\n');
        blockLines.push(processedValue);
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
      const pattern = new RegExp('^' + indent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[A-Za-z_][\\w-]*\\s*:\\s*(?:\\|>.*)?$');
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

  private decodeHtmlEntitiesInObject(obj: any): any {
    if (typeof obj === 'string') {
      return obj
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");
    } else if (Array.isArray(obj)) {
      return obj.map(item => this.decodeHtmlEntitiesInObject(item));
    } else if (obj && typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.decodeHtmlEntitiesInObject(value);
      }
      return result;
    }
    return obj;
  }

  private async getYamlErrorHelp(tagName: string, content: string, error: yaml.YAMLException): Promise<string> {
    const helps: string[] = [];
    
    // Try error recovery first
    const recovery = await YamlErrorRecovery.tryRecover(content, error);
    if (recovery.suggestion) {
      helps.push('RECOVERY: ' + recovery.suggestion);
    }
    
    // Add specific hints based on error
    if (error.message.includes('bad indentation')) {
      helps.push('HINT: Use consistent 2-space indentation. Check that all fields are properly aligned.');
    }
    
    if (error.message.includes('end of the stream') || error.message.includes('unexpected end')) {
      helps.push('HINT: The YAML content appears to be incomplete. Make sure to include all required fields.');
      helps.push(`For <${tagName}> actions, check the documentation for required fields.`);
    }
    
    if (error.message.includes('could not find expected \':\' ')) {
      helps.push('HINT: YAML requires proper spacing. Use "key: value" with a space after the colon.');
    }
    
    if (content.includes(':') && !content.includes('|')) {
      helps.push('HINT: If your content contains colons, use block scalar syntax: |');
      helps.push('Example:');
      helps.push('  oldString: |');
      helps.push('    line with: colons');
    }
    
    // Add action-specific examples if no recovery suggestions
    if (helps.length === 0 || (recovery.recoveryAttempts && recovery.recoveryAttempts.length === 0)) {
      helps.push(this.getActionExample(tagName));
    }
    
    return helps.join('\n  ');
  }

  private getActionExample(tagName: string): string {
    const examples: Record<string, string> = {
      bash: 'Example:\n  cmd: "ls -la"\n  block: true\n  timeoutSecs: 60',
      read: 'Example:\n  filePath: "/path/to/file.txt"\n  offset: 1\n  limit: 100',
      write: 'Example:\n  filePath: "/path/to/file.txt"\n  content: "Hello World"',
      edit: 'Example:\n  filePath: "/path/to/file.txt"\n  oldString: "old text"\n  newString: "new text"\n  replaceAll: false',
      grep: 'Example:\n  pattern: "TODO"\n  path: "./src"\n  include: "*.js"',
      ls: 'Example:\n  path: "./src"\n  ignore: ["node_modules", ".git"]',
    };
    
    return examples[tagName] || `Example: Check documentation for <${tagName}> action syntax`;
  }
  
  private getZodErrorHelp(tagName: string, error: z.ZodError): string {
    const helps: string[] = [];
    
    // Provide specific help based on the tag type and missing fields
    const missingFields = error.errors.filter(e => e.code === 'invalid_type' && e.received === 'undefined');
    
    if (missingFields.length > 0) {
      helps.push(`HINT: Missing required fields: ${missingFields.map(e => e.path.join('.')).join(', ')}`);
    }
    
    // Tag-specific guidance
    if (tagName === 'file') {
      helps.push('For file operations, use:');
      helps.push('  action: read|write|edit|multi_edit|metadata');
      helps.push('  filePath: path/to/file');
      if (error.errors.some(e => e.path.includes('newString'))) {
        helps.push('  For edit actions, you must include both oldString and newString');
      }
    } else if (tagName === 'bash') {
      helps.push('For bash commands:');
      helps.push('  cmd: your command (use | for multi-line)');
      helps.push('  block: true/false');
      helps.push('  timeoutSecs: number (max 300)');
    } else if (tagName === 'task_create') {
      helps.push('For task creation:');
      helps.push('  agentType: explorer|coder');
      helps.push('  title: short title');
      helps.push('  description: detailed instructions');
    }
    
    return helps.join('\n  ');
  }
}

