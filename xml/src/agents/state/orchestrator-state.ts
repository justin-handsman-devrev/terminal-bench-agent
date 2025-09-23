import { OrchestratorState as IOrchestratorState, Turn } from '../../types';
import { OrchestratorHub } from '../actions/orchestrator-hub';
import { ContextDeduplicator, SimilarityResult } from './context-deduplication';

export class ConversationHistoryManager {
  private turns: Turn[] = [];
  private maxTurns: number = 100;
  private contextDeduplicator: ContextDeduplicator;

  constructor(enableDeduplication: boolean = true) {
    this.contextDeduplicator = new ContextDeduplicator({
      similarityThreshold: enableDeduplication ? 0.85 : 0.0, // Disable if needed
      maxContextEntries: 500,
      enableEmbeddings: true
    });
  }

  async addTurn(turn: Turn): Promise<SimilarityResult | null> {
    this.turns.push(turn);
    if (this.turns.length > this.maxTurns) {
      this.turns = this.turns.slice(-this.maxTurns);
    }

    // Check for duplicate context in environment responses
    let deduplicationResult: SimilarityResult | null = null;
    
    for (const response of turn.envResponses) {
      if (response.length > 100) { // Only check substantial responses
        const result = await this.contextDeduplicator.addContext(
          response,
          `turn_${this.turns.length}_env_response`,
          { turnIndex: this.turns.length - 1 }
        );
        
        if (result.isDuplicate && !deduplicationResult) {
          deduplicationResult = result;
        }
      }
    }

    return deduplicationResult;
  }

  toPrompt(): string {
    if (this.turns.length === 0) {
      return 'No previous interactions.';
    }

    const turnStrs: string[] = [];
    for (let i = 0; i < this.turns.length; i++) {
      const turn = this.turns[i];
      turnStrs.push(`--- Turn ${i + 1} ---\n${this.turnToPrompt(turn)}`);
    }

    return turnStrs.join('\n\n');
  }

  private turnToPrompt(turn: Turn): string {
    const parts: string[] = [];

    if (turn.llmOutput.length > 500) {
      parts.push(`Agent: ${turn.llmOutput.slice(0, 500)}...`);
    } else {
      parts.push(`Agent: ${turn.llmOutput}`);
    }

    if (turn.envResponses.length > 0) {
      for (const response of turn.envResponses) {
        parts.push(`Env: ${response}`);
      }
    }

    return parts.join('\n');
  }

  toDict(): Turn[] {
    return this.turns.map(turn => ({
      llmOutput: turn.llmOutput,
      actionsExecuted: turn.actionsExecuted,
      envResponses: turn.envResponses,
      subagentTrajectories: turn.subagentTrajectories,
    }));
  }

  getTurns(): Turn[] {
    return [...this.turns];
  }

  getContextSummary() {
    return this.contextDeduplicator.getContextSummary();
  }

  findDuplicateClusters(threshold: number = 0.8) {
    return this.contextDeduplicator.findDuplicateClusters(threshold);
  }

  purgeOldContext(maxAge: number = 24 * 60 * 60 * 1000): number {
    return this.contextDeduplicator.purgeOldContext(maxAge);
  }

  async checkContextSimilarity(content: string, source: string): Promise<SimilarityResult> {
    return this.contextDeduplicator.addContext(content, source);
  }
}

export class OrchestratorState {
  public done: boolean = false;
  public finishMessage?: string;

  constructor(
    public orchestratorHub: OrchestratorHub,
    public conversationHistory: ConversationHistoryManager
  ) {}

  toDict(): IOrchestratorState {
    const tasks = this.orchestratorHub.getTasks();
    const contextStore = this.orchestratorHub.getContextStore();

    return {
      done: this.done,
      finishMessage: this.finishMessage,
      tasks,
      contextStore,
      conversationHistory: {
        turns: this.conversationHistory.getTurns(),
        maxTurns: 100,
      },
    };
  }

  toPrompt(): string {
    const sections: string[] = [];

    // Add task manager state
    sections.push('## Task Manager State\n');
    sections.push(this.orchestratorHub.viewAllTasks());
    sections.push('\n## Context Store\n');
    sections.push(this.orchestratorHub.viewContextStore());

    // Add conversation history
    sections.push('\n## Conversation History\n');
    sections.push(this.conversationHistory.toPrompt());

    return sections.join('\n');
  }
}
