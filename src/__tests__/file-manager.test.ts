/**
 * Test suite for file manager functionality
 */

import { FileManager } from '../agents/actions/file-manager';
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

    // Default response
    return { output: `Executed: ${cmd}`, exitCode: 0 };
  }

  async executeBackground(cmd: string): Promise<void> {
    // Mock implementation
  }
}

describe('FileManager', () => {
  let fileManager: FileManager;
  let mockExecutor: MockCommandExecutor;

  beforeEach(() => {
    mockExecutor = new MockCommandExecutor();
    fileManager = new FileManager(mockExecutor);
  });

  describe('readFile', () => {
    it('should read file with line numbers', async () => {
      const expectedOutput = `     1\tHello
     2\tWorld`;
      mockExecutor.setMockResponse("nl -ba '/test/file.txt' 2>&1", expectedOutput);

      const [content, isError] = await fileManager.readFile('/test/file.txt');

      expect(isError).toBe(false);
      expect(content).toBe(expectedOutput);
    });

    it('should handle file not found', async () => {
      mockExecutor.setMockResponse("nl -ba '/nonexistent.txt' 2>&1", 'No such file or directory', 1);

      const [content, isError] = await fileManager.readFile('/nonexistent.txt');

      expect(isError).toBe(true);
      expect(content).toContain('File not found');
    });

    it('should read with offset and limit', async () => {
      const expectedOutput = `    10\tLine 10
    11\tLine 11`;
      mockExecutor.setMockResponse("tail -n +10 '/test/file.txt' 2>&1 | head -n 2 | nl -ba -v 10", expectedOutput);

      const [content, isError] = await fileManager.readFile('/test/file.txt', 10, 2);

      expect(isError).toBe(false);
      expect(content).toBe(expectedOutput);
    });
  });

  describe('writeFile', () => {
    it('should write file successfully', async () => {
      // Mock mkdir command
      mockExecutor.setMockResponse("mkdir -p '/tmp'", '', 0);
      // Mock base64 decode command
      mockExecutor.setMockResponse('base64 -d', '', 0);
      // Mock node execution
      mockExecutor.setMockResponse('node', 'File written successfully', 0);
      // Mock removal of temporary script
      mockExecutor.setMockResponse('rm -f', '', 0);

      const [content, isError] = await fileManager.writeFile('/tmp/test.txt', 'Hello World');

      expect(isError).toBe(false);
      expect(content).toContain('Successfully wrote to');
    });

    it('should handle write errors', async () => {
      // Mock mkdir command
      mockExecutor.setMockResponse("mkdir -p '/tmp'", '', 0);
      // Mock base64 decode command
      mockExecutor.setMockResponse('base64 -d', '', 0);
      // Mock node execution with error
      mockExecutor.setMockResponse('node', 'Error: Permission denied', 1);
      // Mock removal of temporary script
      mockExecutor.setMockResponse('rm -f', '', 0);

      const [content, isError] = await fileManager.writeFile('/readonly/test.txt', 'content');

      expect(isError).toBe(true);
      expect(content).toContain('Error writing file');
    });
  });

  describe('editFile', () => {
    it('should edit file successfully', async () => {
      // Mock backup command
      mockExecutor.setMockResponse("cp '/test.txt' '/test.txt.bak' 2>&1", '', 0);
      // Mock node edit command
      mockExecutor.setMockResponse('node -e', '', 0);
      // Mock cleanup command
      mockExecutor.setMockResponse("rm -f '/test.txt.bak'", '', 0);

      const [content, isError] = await fileManager.editFile('/test.txt', 'old', 'new');

      expect(isError).toBe(false);
      expect(content).toContain('Successfully replaced');
    });

    it('should handle file not found for edit', async () => {
      mockExecutor.setMockResponse("cp '/nonexistent.txt' '/nonexistent.txt.bak' 2>&1", 'No such file or directory', 1);

      const [content, isError] = await fileManager.editFile('/nonexistent.txt', 'old', 'new');

      expect(isError).toBe(true);
      expect(content).toContain('File not found');
    });
  });

  describe('getMetadata', () => {
    it('should get file metadata', async () => {
      const statOutput = '1024 1640995200 user:group 644 text/plain';
      mockExecutor.setMockResponse('*stat*', statOutput);

      const [content, isError] = await fileManager.getMetadata(['/test.txt']);

      expect(isError).toBe(false);
      expect(content).toContain('/test.txt:');
      expect(content).toContain('Size: 1024 bytes');
    });

    it('should handle file not found for metadata', async () => {
      mockExecutor.setMockResponse('*stat*', 'not_found');

      const [content, isError] = await fileManager.getMetadata(['/nonexistent.txt']);

      expect(isError).toBe(false);
      expect(content).toContain('Not found');
    });

    it('should limit to 10 files', async () => {
      const files = Array.from({ length: 15 }, (_, i) => `/file${i}.txt`);
      mockExecutor.setMockResponse('*stat*', 'not_found');

      const [content, isError] = await fileManager.getMetadata(files);

      expect(isError).toBe(false);
      // Should only process first 10 files
      const lines = content.split('\n').filter(line => line.includes('/file'));
      expect(lines.length).toBeLessThanOrEqual(10);
    });
  });
});
