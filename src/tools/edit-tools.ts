import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseTool } from './base-tool';
import { ToolContext, ToolResult } from '../types';

export class ApplyTextEditsTool extends BaseTool {
  name = 'apply_text_edits';
  description = 'Apply multiple text edits to a file using start/end lines or markers.';
  parameters = z.object({
    file_path: z.string().describe('Path to the file to edit'),
    edits: z.array(z.object({
      start_line: z.number().optional().describe('1-based inclusive start line of the range to replace'),
      end_line: z.number().optional().describe('1-based inclusive end line of the range to replace'),
      before_marker: z.string().optional().describe('Unique text to find before the insertion/replacement'),
      after_marker: z.string().optional().describe('Unique text to find after the insertion/replacement'),
      new_text: z.string().default('').describe('Replacement text or inserted text'),
      mode: z.enum(['replace', 'insert_before', 'insert_after']).default('replace')
    })).min(1).describe('List of edits to apply in order')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      if (!context.config.tools.enableFileOperations) {
        return this.createErrorResult('File operations are disabled');
      }

      const { file_path, edits } = this.validateParams<{
        file_path: string;
        edits: Array<{
          start_line?: number;
          end_line?: number;
          before_marker?: string;
          after_marker?: string;
          new_text: string;
          mode: 'replace' | 'insert_before' | 'insert_after';
        }>;
      }>(params);

      const fullPath = path.resolve(context.repositoryPath, file_path);
      if (!fullPath.startsWith(context.repositoryPath)) {
        return this.createErrorResult('Access denied: Path outside repository');
      }
      if (!(await fs.pathExists(fullPath))) {
        return this.createErrorResult('File not found');
      }

      const original = await fs.readFile(fullPath, 'utf-8');
      let modified = original;

      for (const edit of edits) {
        const usingRange = edit.start_line !== undefined || edit.end_line !== undefined;
        const usingMarkers = !!(edit.before_marker || edit.after_marker);
        if (usingRange && usingMarkers) {
          return this.createErrorResult('Use either range (start_line/end_line) or markers, not both');
        }

        if (usingRange) {
          const start = Math.max(1, edit.start_line ?? edit.end_line ?? 1) - 1;
          const end = Math.max(start, (edit.end_line ?? edit.start_line ?? (start + 1)) - 1);
          const lines = modified.split('\n');
          const head = lines.slice(0, start).join('\n');
          const tail = lines.slice(end + 1).join('\n');
          modified = [head, edit.new_text, tail].filter(Boolean).join('\n');
          continue;
        }

        const beforeIdx = edit.before_marker ? modified.indexOf(edit.before_marker) : -1;
        const afterIdx = edit.after_marker ? modified.indexOf(edit.after_marker) : -1;

        if (edit.mode === 'replace') {
          if (edit.before_marker && edit.after_marker && beforeIdx !== -1 && afterIdx !== -1 && afterIdx >= beforeIdx) {
            modified = modified.slice(0, beforeIdx + edit.before_marker.length) + edit.new_text + modified.slice(afterIdx);
          } else {
            return this.createErrorResult('Markers not found for replace operation');
          }
        } else if (edit.mode === 'insert_before') {
          if (edit.before_marker && beforeIdx !== -1) {
            modified = modified.slice(0, beforeIdx) + edit.new_text + modified.slice(beforeIdx);
          } else {
            return this.createErrorResult('before_marker not found for insert_before');
          }
        } else if (edit.mode === 'insert_after') {
          if (edit.after_marker && afterIdx !== -1) {
            const insertPos = afterIdx + edit.after_marker.length;
            modified = modified.slice(0, insertPos) + edit.new_text + modified.slice(insertPos);
          } else {
            return this.createErrorResult('after_marker not found for insert_after');
          }
        }
      }

      if (modified !== original) {
        await fs.writeFile(fullPath, modified, 'utf-8');
        context.logger.debug(`Applied ${edits.length} edits to ${file_path}`);
      }

      return this.createSuccessResult({
        path: file_path,
        changed: modified !== original,
        original_length: original.length,
        new_length: modified.length
      }, modified !== original ? `Updated ${file_path}` : 'No changes applied');
    } catch (error: any) {
      return this.createErrorResult(`Failed to apply text edits: ${error.message}`);
    }
  }
}

export class InsertTextTool extends BaseTool {
  name = 'insert_text';
  description = 'Insert text into a file at a specific line or around a marker.';
  parameters = z.object({
    file_path: z.string().describe('Path to the file to modify'),
    new_text: z.string().describe('Text to insert'),
    line: z.number().optional().describe('1-based line to insert before'),
    before_marker: z.string().optional().describe('Insert before the first occurrence of this text'),
    after_marker: z.string().optional().describe('Insert after the first occurrence of this text')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      if (!context.config.tools.enableFileOperations) {
        return this.createErrorResult('File operations are disabled');
      }

      const { file_path, new_text, line, before_marker, after_marker } = this.validateParams<{
        file_path: string;
        new_text: string;
        line?: number;
        before_marker?: string;
        after_marker?: string;
      }>(params);

      const fullPath = path.resolve(context.repositoryPath, file_path);
      if (!fullPath.startsWith(context.repositoryPath)) {
        return this.createErrorResult('Access denied: Path outside repository');
      }
      if (!(await fs.pathExists(fullPath))) {
        return this.createErrorResult('File not found');
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      let modified = content;

      if (line !== undefined) {
        const lines = content.split('\n');
        const idx = Math.max(0, Math.min(lines.length, line - 1));
        lines.splice(idx, 0, new_text);
        modified = lines.join('\n');
      } else if (before_marker) {
        const idx = content.indexOf(before_marker);
        if (idx === -1) return this.createErrorResult('before_marker not found');
        modified = content.slice(0, idx) + new_text + content.slice(idx);
      } else if (after_marker) {
        const idx = content.indexOf(after_marker);
        if (idx === -1) return this.createErrorResult('after_marker not found');
        const insertPos = idx + after_marker.length;
        modified = content.slice(0, insertPos) + new_text + content.slice(insertPos);
      } else {
        return this.createErrorResult('Must provide line, before_marker, or after_marker');
      }

      if (modified !== content) {
        await fs.writeFile(fullPath, modified, 'utf-8');
        context.logger.debug(`Inserted text into ${file_path}`);
      }

      return this.createSuccessResult({ path: file_path, changed: modified !== content }, modified !== content ? `Updated ${file_path}` : 'No changes applied');
    } catch (error: any) {
      return this.createErrorResult(`Failed to insert text: ${error.message}`);
    }
  }
}


