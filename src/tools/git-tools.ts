import { z } from 'zod';
import simpleGit from 'simple-git';
import { BaseTool } from './base-tool';
import { ToolContext, ToolResult } from '../types';

export class GitStatusTool extends BaseTool {
  name = 'git_status';
  description = 'Get the current git status of the repository';
  parameters = z.object({});

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      if (!context.config.tools.enableGitOperations) {
        return this.createErrorResult('Git operations are disabled');
      }

      const git = simpleGit(context.repositoryPath);
      const status = await git.status();

      context.logger.debug(`Git status: ${status.files.length} changes`);

      return this.createSuccessResult({
        branch: status.current,
        ahead: status.ahead,
        behind: status.behind,
        staged: status.staged,
        modified: status.modified,
        deleted: status.deleted,
        created: status.created,
        untracked: status.not_added,
        conflicted: status.conflicted,
        clean: status.isClean()
      });
    } catch (error: any) {
      return this.createErrorResult(`Failed to get git status: ${error.message}`);
    }
  }
}

export class GitDiffTool extends BaseTool {
  name = 'git_diff';
  description = 'Get the diff for specific files or all changes';
  parameters = z.object({
    file_path: z.string().optional().describe('Specific file to get diff for'),
    staged: z.boolean().default(false).describe('Show staged changes instead of working directory changes')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      if (!context.config.tools.enableGitOperations) {
        return this.createErrorResult('Git operations are disabled');
      }

      const { file_path, staged } = this.validateParams<{
        file_path?: string;
        staged: boolean;
      }>(params);

      const git = simpleGit(context.repositoryPath);
      
      let diff: string;
      if (staged) {
        const args = ['--cached', file_path].filter(Boolean) as string[];
        diff = await git.diff(args);
      } else {
        const args = [file_path].filter(Boolean) as string[];
        diff = await git.diff(args);
      }

      context.logger.debug(`Git diff: ${staged ? 'staged' : 'working'} changes${file_path ? ` for ${file_path}` : ''}`);

      return this.createSuccessResult({
        diff,
        staged,
        file_path: file_path || 'all files'
      });
    } catch (error: any) {
      return this.createErrorResult(`Failed to get git diff: ${error.message}`);
    }
  }
}

export class GitLogTool extends BaseTool {
  name = 'git_log';
  description = 'Get commit history';
  parameters = z.object({
    max_count: z.number().default(10).describe('Maximum number of commits to retrieve'),
    file_path: z.string().optional().describe('Get log for specific file')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      if (!context.config.tools.enableGitOperations) {
        return this.createErrorResult('Git operations are disabled');
      }

      const { max_count, file_path } = this.validateParams<{
        max_count: number;
        file_path?: string;
      }>(params);

      const git = simpleGit(context.repositoryPath);
      
      const logOptions: any = { maxCount: max_count };
      if (file_path) {
        logOptions.file = file_path;
      }

      const log = await git.log(logOptions);

      const commits = log.all.map(commit => ({
        hash: commit.hash,
        date: commit.date,
        message: commit.message,
        author: commit.author_name,
        email: commit.author_email
      }));

      context.logger.debug(`Git log: ${commits.length} commits`);

      return this.createSuccessResult({
        commits,
        total: commits.length
      });
    } catch (error: any) {
      return this.createErrorResult(`Failed to get git log: ${error.message}`);
    }
  }
}

export class GitAddTool extends BaseTool {
  name = 'git_add';
  description = 'Stage files for commit';
  parameters = z.object({
    file_paths: z.array(z.string()).describe('Files to stage for commit'),
    all: z.boolean().default(false).describe('Stage all changes')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      if (!context.config.tools.enableGitOperations) {
        return this.createErrorResult('Git operations are disabled');
      }

      const { file_paths, all } = this.validateParams<{
        file_paths: string[];
        all: boolean;
      }>(params);

      const git = simpleGit(context.repositoryPath);

      if (all) {
        await git.add('.');
        context.logger.debug('Staged all changes');
      } else {
        await git.add(file_paths);
        context.logger.debug(`Staged files: ${file_paths.join(', ')}`);
      }

      return this.createSuccessResult({
        staged: all ? 'all files' : file_paths,
        message: `Successfully staged ${all ? 'all changes' : file_paths.length + ' files'}`
      });
    } catch (error: any) {
      return this.createErrorResult(`Failed to stage files: ${error.message}`);
    }
  }
}

export class GitCommitTool extends BaseTool {
  name = 'git_commit';
  description = 'Commit staged changes';
  parameters = z.object({
    message: z.string().describe('Commit message'),
    add_all: z.boolean().default(false).describe('Add all changes before committing')
  });

  async execute(params: any, context: ToolContext): Promise<ToolResult> {
    try {
      if (!context.config.tools.enableGitOperations) {
        return this.createErrorResult('Git operations are disabled');
      }

      const { message, add_all } = this.validateParams<{
        message: string;
        add_all: boolean;
      }>(params);

      const git = simpleGit(context.repositoryPath);

      if (add_all) {
        await git.add('.');
      }

      const result = await git.commit(message);

      context.logger.debug(`Created commit: ${result.commit}`);

      return this.createSuccessResult({
        commit: result.commit,
        summary: result.summary,
        message
      }, `Successfully created commit: ${result.commit}`);
    } catch (error: any) {
      return this.createErrorResult(`Failed to commit: ${error.message}`);
    }
  }
}
