/**
 * Test suite for build validation functionality
 */

import { ActionHandler } from '../agents/actions/parsing/action-handler';
import { TurnExecutor } from '../agents/execution/turn-executor';
import { SimpleActionParser } from '../agents/actions/parsing/parser';
import { CommandExecutor } from '../core/execution/command-executor';

// Mock command executor
class MockCommandExecutor extends CommandExecutor {
  private mockResponses: Record<string, { output: string; exitCode: number }> = {};

  setMockResponse(cmd: string, output: string, exitCode: number = 0) {
    this.mockResponses[cmd] = { output, exitCode };
  }

  async execute(cmd: string, timeout?: number): Promise<{ output: string; exitCode: number }> {
    // Try to find exact match first
    if (this.mockResponses[cmd]) {
      return this.mockResponses[cmd];
    }

    // Try to find partial matches for common commands
    for (const [mockCmd, response] of Object.entries(this.mockResponses)) {
      if (cmd.includes(mockCmd) || mockCmd.includes('*')) {
        return response;
      }
    }

    // Default successful response for unknown commands
    return { output: `Mock executed: ${cmd}`, exitCode: 0 };
  }

  async executeBackground(cmd: string): Promise<void> {
    // Mock implementation
  }
}

describe('Build Validation', () => {
  let actionHandler: ActionHandler;
  let turnExecutor: TurnExecutor;
  let actionParser: SimpleActionParser;
  let mockExecutor: MockCommandExecutor;

  beforeEach(() => {
    mockExecutor = new MockCommandExecutor();
    actionHandler = new ActionHandler(mockExecutor);
    actionParser = new SimpleActionParser();
    turnExecutor = new TurnExecutor(actionParser, actionHandler);
  });

  describe('code change detection', () => {
    it('should detect code changes for TypeScript files', async () => {
      // Mock file write operation
      mockExecutor.setMockResponse('mkdir -p', '', 0);
      mockExecutor.setMockResponse('which node', '/usr/bin/node', 0);
      mockExecutor.setMockResponse('echo', '', 0);
      mockExecutor.setMockResponse('node', 'File written successfully', 0);

      const xml = `<file>
action: write
filePath: src/test.ts
content: |
  export function hello() {
    return "world";
  }
</file>`;

      await turnExecutor.execute(xml);
      
      expect(actionHandler.hasCodeChanges()).toBe(true);
      expect(actionHandler.getModifiedFiles()).toContain('src/test.ts');
    });

    it('should not detect changes for non-code files', async () => {
      // Mock file write operation  
      mockExecutor.setMockResponse('mkdir -p', '', 0);
      mockExecutor.setMockResponse('cat', 'File written successfully', 0);

      const xml = `<file>
action: write
filePath: README.md
content: |
  # Test Project
  This is a test.
</file>`;

      await turnExecutor.execute(xml);
      
      expect(actionHandler.hasCodeChanges()).toBe(false);
    });
  });

  describe('build validation', () => {
    it('should run TypeScript validation when tsconfig.json exists', async () => {
      // Setup code change
      actionHandler.hasCodeChanges = jest.fn().mockReturnValue(true);
      
      // Mock build detection
      mockExecutor.setMockResponse('test -f tsconfig.json && echo "typescript" || echo "none"', 'typescript', 0);
      mockExecutor.setMockResponse('npx tsc --noEmit 2>&1', 'TypeScript compilation successful', 0);
      
      const [result, hasError] = await actionHandler.runBuildValidation();
      
      expect(hasError).toBe(false);
      expect(result).toContain('TYPESCRIPT SUCCESS');
    });

    it('should fail validation when TypeScript compilation fails', async () => {
      // Setup code change
      actionHandler.hasCodeChanges = jest.fn().mockReturnValue(true);
      
      // Mock build detection with error
      mockExecutor.setMockResponse('test -f tsconfig.json && echo "typescript" || echo "none"', 'typescript', 0);
      mockExecutor.setMockResponse('npx tsc --noEmit 2>&1', 'Error: Type error on line 5', 1);
      
      const [result, hasError] = await actionHandler.runBuildValidation();
      
      expect(hasError).toBe(true);
      expect(result).toContain('TYPESCRIPT ERROR');
    });

    it('should run Node.js validation when package.json exists', async () => {
      // Mock build detection
      mockExecutor.setMockResponse('test -f package.json && echo "nodejs" || echo "none"', 'nodejs', 0);
      mockExecutor.setMockResponse('cat package.json 2>/dev/null | grep -E "(build|compile)" || echo "none"', '"build": "tsc"', 0);
      mockExecutor.setMockResponse('npm run build 2>&1', 'Build successful', 0);
      
      const [result, hasError] = await actionHandler.runBuildValidation();
      
      expect(hasError).toBe(false);
      expect(result).toContain('BUILD SUCCESS');
    });
  });

  describe('finish action with build validation', () => {
    it('should block finish when build validation fails', async () => {
      // Mock code changes occurred
      actionHandler.hasCodeChanges = jest.fn().mockReturnValue(true);
      actionHandler.runBuildValidation = jest.fn().mockResolvedValue(['BUILD ERROR: TypeScript failed', true]);
      
      const xml = `<finish>
message: "Task completed"
</finish>`;

      const result = await turnExecutor.execute(xml);
      
      expect(result.done).toBe(false);
      expect(result.hasError).toBe(true);
      expect(result.envResponses.some(resp => resp.includes('CRITICAL build/compilation errors found'))).toBe(true);
    });

    it('should allow finish when build validation passes', async () => {
      // Mock code changes occurred
      actionHandler.hasCodeChanges = jest.fn().mockReturnValue(true);
      actionHandler.runBuildValidation = jest.fn().mockResolvedValue(['BUILD SUCCESS: All checks passed', false]);
      actionHandler.clearCodeChangeTracking = jest.fn();
      
      const xml = `<finish>
message: "Task completed successfully"
</finish>`;

      const result = await turnExecutor.execute(xml);
      
      expect(result.done).toBe(true);
      expect(result.hasError).toBe(false);
      expect(result.finishMessage).toBe('Task completed successfully');
      expect(result.envResponses.some(resp => resp.includes('Build/test validation passed'))).toBe(true);
      expect(actionHandler.clearCodeChangeTracking).toHaveBeenCalled();
    });

    it('should allow finish without validation when no code changes occurred', async () => {
      // Mock no code changes
      actionHandler.hasCodeChanges = jest.fn().mockReturnValue(false);
      
      const xml = `<finish>
message: "Non-code task completed"
</finish>`;

      const result = await turnExecutor.execute(xml);
      
      expect(result.done).toBe(true);
      expect(result.hasError).toBe(false);
      expect(result.finishMessage).toBe('Non-code task completed');
    });
  });

  describe('C++ validation', () => {
    it('should run C++ compilation validation', async () => {
      // Mock C++ file detection
      mockExecutor.setMockResponse('find . -name "*.cpp" -o -name "*.c" -o -name "*.cc" | head -1', 'main.cpp', 0);
      mockExecutor.setMockResponse('find . -name "*.cpp" -o -name "*.c" -o -name "*.cc" | head -5', 'main.cpp\nutils.cpp', 0);
      mockExecutor.setMockResponse('g++ -c "main.cpp" -o /tmp/test.o 2>&1', '', 0);
      mockExecutor.setMockResponse('g++ -c "utils.cpp" -o /tmp/test.o 2>&1', '', 0);
      mockExecutor.setMockResponse('rm -f /tmp/test.o', '', 0);
      
      const [result, hasError] = await actionHandler.runBuildValidation();
      
      expect(hasError).toBe(false);
      expect(result).toContain('C++ SUCCESS');
    });

    it('should fail C++ validation on compilation error', async () => {
      // Mock C++ compilation failure
      mockExecutor.setMockResponse('find . -name "*.cpp" -o -name "*.c" -o -name "*.cc" | head -1', 'main.cpp', 0);
      mockExecutor.setMockResponse('find . -name "*.cpp" -o -name "*.c" -o -name "*.cc" | head -5', 'main.cpp', 0);
      mockExecutor.setMockResponse('g++ -c "main.cpp" -o /tmp/test.o 2>&1', 'error: expected semicolon before }', 1);
      
      const [result, hasError] = await actionHandler.runBuildValidation();
      
      expect(hasError).toBe(true);
      expect(result).toContain('C++ ERROR');
    });
  });
});
