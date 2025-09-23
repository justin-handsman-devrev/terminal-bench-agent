/**
 * Test suite for orchestrator functionality
 */

import { OrchestratorAgent } from '../agents/orchestrator-agent';
import { LocalExecutor } from '../core/execution/command-executor';

// Mock the LLM client for testing
jest.mock('../core/llm/client', () => {
  return {
    LLMClient: jest.fn().mockImplementation(() => ({
      getResponse: jest.fn().mockResolvedValue({
        content: `<finish>
message: "Test task completed successfully"
</finish>`,
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
      countInputTokens: jest.fn().mockReturnValue(100),
      countOutputTokens: jest.fn().mockReturnValue(50),
    })),
  };
});

describe('OrchestratorAgent', () => {
  let orchestrator: OrchestratorAgent;
  let executor: LocalExecutor;

  beforeEach(() => {
    executor = new LocalExecutor();
    orchestrator = new OrchestratorAgent({
      model: 'gpt-4',
      temperature: 0.1,
    });
    orchestrator.setup(executor);
  });

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      expect(orchestrator).toBeInstanceOf(OrchestratorAgent);
    });

    it('should have initial state', () => {
      const state = orchestrator.getState();
      expect(state.done).toBe(false);
      expect(state.finishMessage).toBeUndefined();
    });
  });

  describe('task execution', () => {
    it('should execute a simple task', async () => {
      const instruction = 'Create a test file';
      
      const result = await orchestrator.run(instruction, 5);
      
      expect(result.completed).toBe(true);
      expect(result.finishMessage).toBe('Test task completed successfully');
      expect(result.turnsExecuted).toBeGreaterThan(0);
      expect(result.maxTurnsReached).toBe(false);
    });

    it('should respect max turns limit', async () => {
      // Mock LLM to never return finish action
      const mockLLMClient = (orchestrator as any).llmClient;
      mockLLMClient.getResponse.mockResolvedValue({
        content: `<bash>
cmd: "echo 'continuing...'"
</bash>`,
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const result = await orchestrator.run('Never ending task', 3);
      
      expect(result.completed).toBe(false);
      expect(result.turnsExecuted).toBe(3);
      expect(result.maxTurnsReached).toBe(true);
    });
  });

  describe('token usage tracking', () => {
    it('should track token usage', async () => {
      await orchestrator.run('Simple task', 5);
      
      const usage = orchestrator.getTokenUsage();
      expect(usage.input).toBeGreaterThan(0);
      expect(usage.output).toBeGreaterThan(0);
    });
  });
});
