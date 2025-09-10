import { BaseAgent } from './base-agent';
import { AgentContext, AgentResult, LLMMessage } from '../types';

export class CodingAgent extends BaseAgent {
  public readonly name = 'CodingAgent';
  public readonly description = 'A specialized agent for writing, modifying, and analyzing code';
  public readonly capabilities = [
    'Write new code files',
    'Modify existing code',
    'Analyze code structure and quality',
    'Refactor code for better maintainability',
    'Fix bugs and issues',
    'Add tests and documentation',
    'Implement new features',
    'Apply coding best practices'
  ];

  async execute(context: AgentContext): Promise<AgentResult> {
    try {
      this.logger.info('CodingAgent starting execution');
      
      const messages: LLMMessage[] = [
        { role: 'system', content: this.buildSystemPrompt() },
        { role: 'system', content: this.buildContextPrompt(context) },
        { role: 'user', content: context.request }
      ];

      // Add conversation history
      messages.push(...context.conversation);

      let iterations = 0;
      const maxIterations = 20; // headroom for complex tasks
      const toolsUsed: string[] = [];
      let editPerformed = false;

      while (iterations < maxIterations) {
        iterations++;
        
        const { response, toolCalls } = await this.callLLM(messages, context.availableTools);
        
        messages.push({ role: 'assistant', content: response });

        if (!toolCalls || toolCalls.length === 0) {
          // If request likely requires changes but no tools were called, push LLM to propose concrete edits
          if (this.isChangeRequest(context.request) && !editPerformed && iterations < maxIterations) {
            messages.push({
              role: 'system',
              content: 'You must propose concrete code edits now. Use search_files to find exact files, then apply_text_edits or write_file to implement XML prompt conversion.'
            });
            continue;
          }

          this.logger.info('CodingAgent completed successfully');
          return this.createSuccessResult(
            response,
            { iterations, finalResponse: response },
            toolsUsed,
            this.extractNextActions(response)
          );
        }

        // Execute tools
        const { results, messages: toolMessages } = await this.executeTools(
          toolCalls, 
          context.availableTools, 
          context
        );

        // Track tools used and whether edits occurred
        toolCalls.forEach(call => {
          if (!toolsUsed.includes(call.name)) {
            toolsUsed.push(call.name);
          }
          if (['write_file', 'apply_text_edits', 'insert_text', 'refactor_code'].includes(call.name)) {
            editPerformed = true;
          }
        });

        // Add tool results to conversation
        messages.push(...toolMessages);

        // Check if we should continue based on tool results
        const hasFailures = results.some(result => !result.success);
        const hasProgress = results.some(result => result.success);
        
        // If we have some successful operations, continue
        // If all operations failed and we've tried multiple times, break
        if (hasFailures && !hasProgress && iterations > 3) {
          break;
        }
      }

      this.logger.warn('CodingAgent reached maximum iterations');
      return this.createSuccessResult(
        'Task completed with maximum iterations reached. Some operations may be incomplete.',
        { iterations, maxReached: true },
        toolsUsed
      );
    } catch (error: any) {
      this.logger.error(`CodingAgent execution failed: ${error.message}`);
      return this.createErrorResult(`Agent execution failed: ${error.message}`);
    }
  }

  protected buildSystemPrompt(): string {
    return `${super.buildSystemPrompt()}

As a CodingAgent, you specialize in:

Code Writing & Modification:
- Write clean, well-structured, and maintainable code
- Follow language-specific best practices and conventions
- Add appropriate comments and documentation
- Handle edge cases and error conditions

Code Analysis:
- Analyze existing code for structure, patterns, and quality
- Identify potential issues, bugs, or improvements
- Understand dependencies and relationships between files
- Extract key information about functions, classes, and modules

Problem Solving:
- Break down complex coding tasks into manageable steps
- Research and understand the codebase before making changes
- Test and verify your changes when possible
- Suggest improvements and optimizations

Tool Usage:
- Use read_file to understand existing code
- Use analyze_code to get detailed code structure information
- Use write_file to create or modify files
- Use search_files to find relevant code patterns
- Use git tools to track changes and maintain version control
- Use refactor_code for safe code transformations
 - Use todo_create/todo_update/todo_list to manage TODOs for the task

IMPORTANT: When asked to make code changes:
1. First explore to understand the current structure
2. Then ACTUALLY MODIFY the files using write_file tool
3. Don't just analyze - TAKE ACTION to implement the requested changes
4. After 2-3 exploration steps, start making concrete modifications

TODO Process:
- At the start, create a TODO list from the user's request (todo_create for each actionable item)
- After each step, update the relevant TODO (todo_update status to in_progress/completed)
- Keep TODOs up to date until the task finishes

Always start by understanding the current codebase structure and requirements, then IMPLEMENT the changes.`;
  }

  private buildContextPrompt(context: AgentContext): string {
    return `Repository Context:
- Repository Path: ${context.repositoryPath}
- Available Tools: ${context.availableTools.map(t => t.name).join(', ')}

Current Request: ${context.request}

EXECUTION PLAN:
1. If this is a code modification request, first explore to understand the current structure
2. Identify the specific files that need to be modified
3. Read the relevant files to understand the current format
4. IMPLEMENT the requested changes using write_file
5. Verify the changes were applied correctly

FILE ACCESS POLICY:
- Before calling read_file, first use search_files to narrow down exact file paths
- Prefer exact relative paths when reading files
- Avoid broad reads; target only necessary files

Please analyze the request, use the available tools to understand the codebase, MAKE THE NECESSARY CHANGES, and provide a clear summary of what was accomplished.`;
  }

  private extractNextActions(response: string): string[] {
    const nextActions: string[] = [];
    
    // Look for common action patterns in the response
    const actionPatterns = [
      /need to (.*?)(?:\.|$)/gi,
      /should (.*?)(?:\.|$)/gi,
      /next step.*?is to (.*?)(?:\.|$)/gi,
      /recommend (.*?)(?:\.|$)/gi,
      /suggest (.*?)(?:\.|$)/gi
    ];

    actionPatterns.forEach(pattern => {
      const matches = response.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 10) {
          nextActions.push(match[1].trim());
        }
      }
    });

    return nextActions.slice(0, 3); // Limit to 3 next actions
  }

  private isChangeRequest(request: string): boolean {
    const q = request.toLowerCase();
    return [
      'convert', 'rewrite', 'refactor', 'modify', 'update', 'change',
      'implement', 'replace', 'transform'
    ].some(k => q.includes(k));
  }
}

export class AnalysisAgent extends BaseAgent {
  public readonly name = 'AnalysisAgent';
  public readonly description = 'A specialized agent for analyzing codebases and providing insights';
  public readonly capabilities = [
    'Analyze repository structure',
    'Identify code patterns and architectures',
    'Detect potential issues and improvements',
    'Generate code documentation',
    'Provide code quality metrics',
    'Suggest refactoring opportunities',
    'Identify security concerns',
    'Analyze dependencies and relationships'
  ];

  async execute(context: AgentContext): Promise<AgentResult> {
    try {
      this.logger.info('AnalysisAgent starting execution');
      
      const messages: LLMMessage[] = [
        { role: 'system', content: this.buildAnalysisPrompt() },
        { role: 'user', content: context.request }
      ];

      const { response, toolCalls } = await this.callLLM(messages, context.availableTools);
      const toolsUsed: string[] = [];

      if (toolCalls && toolCalls.length > 0) {
        const { results } = await this.executeTools(toolCalls, context.availableTools, context);
        toolCalls.forEach(call => toolsUsed.push(call.name));

        // Generate final analysis based on tool results
        const analysisMessages: LLMMessage[] = [
          ...messages,
          { role: 'assistant', content: response },
          { role: 'system', content: `Tool execution completed. Results: ${JSON.stringify(results, null, 2)}` },
          { role: 'user', content: 'Please provide a comprehensive analysis based on the gathered data.' }
        ];

        const finalResponse = await this.llmClient.chat(analysisMessages);
        
        return this.createSuccessResult(
          finalResponse.content,
          { toolResults: results, analysis: finalResponse.content },
          toolsUsed
        );
      }

      return this.createSuccessResult(response, { analysis: response }, toolsUsed);
    } catch (error: any) {
      this.logger.error(`AnalysisAgent execution failed: ${error.message}`);
      return this.createErrorResult(`Analysis failed: ${error.message}`);
    }
  }

  private buildAnalysisPrompt(): string {
    return `You are an expert code analysis agent. Your role is to thoroughly analyze codebases and provide valuable insights.

Analysis Focus Areas:
1. Repository Structure - Organization, architecture patterns, file structure
2. Code Quality - Maintainability, readability, complexity, best practices
3. Dependencies - External packages, internal module relationships
4. Security - Potential vulnerabilities, security patterns
5. Performance - Potential bottlenecks, optimization opportunities
6. Testing - Test coverage, test quality, testing patterns
7. Documentation - Code documentation, README quality, inline comments

Available Tools for Analysis:
- list_directory: Explore repository structure
- read_file: Examine specific files
- analyze_code: Get detailed code structure information
- search_files: Find patterns across the codebase
- git_status/git_log: Understand version control history

Analysis Process:
1. Start with repository structure overview
2. Identify key files and entry points
3. Analyze code patterns and architecture
4. Look for potential issues and improvements
5. Provide actionable recommendations

Always provide specific, actionable insights with examples when possible.`;
  }
}

export class PlanningAgent extends BaseAgent {
  public readonly name = 'PlanningAgent';
  public readonly description = 'A strategic agent focused on planning and breaking down complex tasks';
  public readonly capabilities = [
    'Break down complex tasks into steps',
    'Analyze requirements and dependencies',
    'Create implementation roadmaps',
    'Estimate effort and complexity',
    'Identify risks and challenges',
    'Suggest optimal approaches',
    'Coordinate multi-step workflows',
    'Plan testing and validation strategies'
  ];

  async execute(context: AgentContext): Promise<AgentResult> {
    try {
      this.logger.info('PlanningAgent starting execution');
      
      // First, analyze the repository to understand the current state
      const contextMessages: LLMMessage[] = [
        { role: 'system', content: this.buildPlanningPrompt() },
        { role: 'user', content: `Please analyze this repository and then create a detailed plan for: ${context.request}` }
      ];

      // Start with repository analysis
      const analysisTools = context.availableTools.filter(tool => 
        ['list_directory', 'git_status', 'search_files'].includes(tool.name)
      );

      const { response, toolCalls } = await this.callLLM(contextMessages, analysisTools);
      const toolsUsed: string[] = [];

      if (toolCalls && toolCalls.length > 0) {
        const { results, messages: toolMessages } = await this.executeTools(
          toolCalls, 
          context.availableTools, 
          context
        );
        
        toolCalls.forEach(call => toolsUsed.push(call.name));
        
        // Create detailed plan based on analysis
        const planningMessages: LLMMessage[] = [
          ...contextMessages,
          { role: 'assistant', content: response },
          ...toolMessages,
          { role: 'user', content: 'Now create a detailed, step-by-step implementation plan with priorities, dependencies, and estimated complexity.' }
        ];

        const planResponse = await this.llmClient.chat(planningMessages);
        
        return this.createSuccessResult(
          planResponse.content,
          { 
            analysis: response, 
            plan: planResponse.content,
            toolResults: results 
          },
          toolsUsed,
          this.extractPlanSteps(planResponse.content)
        );
      }

      return this.createSuccessResult(response, { plan: response }, toolsUsed);
    } catch (error: any) {
      this.logger.error(`PlanningAgent execution failed: ${error.message}`);
      return this.createErrorResult(`Planning failed: ${error.message}`);
    }
  }

  private buildPlanningPrompt(): string {
    return `You are an expert planning agent specialized in software development project planning.

Planning Methodology:
1. Requirements Analysis - Understand what needs to be built/changed
2. Current State Assessment - Analyze existing codebase and constraints
3. Gap Analysis - Identify what's missing or needs to be modified
4. Task Decomposition - Break complex goals into manageable steps
5. Dependency Mapping - Understand task relationships and prerequisites
6. Risk Assessment - Identify potential challenges and mitigation strategies
7. Resource Planning - Estimate effort and required skills

Plan Structure:
- Executive Summary
- Requirements and Goals
- Current State Analysis
- Proposed Approach
- Detailed Steps (with priorities and dependencies)
- Risk Mitigation
- Testing and Validation Strategy
- Timeline Estimates

For each step in the plan, include:
- Clear description and acceptance criteria
- Dependencies on other steps
- Estimated complexity (Low/Medium/High)
- Required tools and resources
- Potential risks and mitigation approaches

Focus on creating actionable, well-sequenced plans that can be executed by other agents.`;
  }

  private extractPlanSteps(planContent: string): string[] {
    const steps: string[] = [];
    
    // Look for numbered or bulleted steps
    const stepPatterns = [
      /^\d+\.\s*(.+)$/gm,
      /^-\s*(.+)$/gm,
      /^\*\s*(.+)$/gm,
      /^Step \d+:\s*(.+)$/gmi
    ];

    stepPatterns.forEach(pattern => {
      const matches = planContent.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && match[1].length > 20) {
          steps.push(match[1].trim());
        }
      }
    });

    return steps.slice(0, 10); // Limit to 10 main steps
  }
}
