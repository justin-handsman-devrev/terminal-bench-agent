import winston from 'winston';
import { SimpleActionParser } from '../actions/parsing/parser';
import { ActionHandler } from '../actions/parsing/action-handler';
import { AnyAction, isFinishAction, FinishAction } from '../actions/entities/actions';

export interface ExecutionResult {
  actionsExecuted: AnyAction[];
  envResponses: string[];
  hasError: boolean;
  finishMessage?: string;
  done: boolean;
  subagentTrajectories?: Record<string, Record<string, any>>;
}

export class TurnExecutor {
  constructor(
    private actionParser: SimpleActionParser,
    private actionHandler: ActionHandler
  ) {}

  async execute(llmOutput: string): Promise<ExecutionResult> {
    const { actions, errors, foundActionAttempt } = this.actionParser.parseResponse(llmOutput);

    if (!foundActionAttempt) {
      winston.warn('No actions attempted in response');
      return {
        actionsExecuted: [],
        envResponses: ['No actions were attempted. Please use the XML action format specified in your system message.'],
        hasError: true,
        done: false, 
      };
    }

    const actionsExecuted: AnyAction[] = [];
    const envResponses: string[] = [];
    let hasError = false;
    let finishMessage: string | undefined;
    let done = false;

    if (errors.length > 0) {
      hasError = true;
      envResponses.push('[PARSE ERROR] The following XML parsing errors occurred:');
      for (const error of errors) {
        envResponses.push(`  - ${error}`);
      }
      envResponses.push('Please ensure your XML tags are properly matched (e.g., <task_create>...</task_create>) and contain valid YAML content. For multi-line edits, use block scalars: oldString: | / newString: |');

      if (actions.length === 0) {
        return {
          actionsExecuted: [],
          envResponses,
          hasError: true,
          done: false,
        };
      }
    }

    for (const action of actions) {
      try {
        const [output, isError] = await this.actionHandler.handleAction(action);
        actionsExecuted.push(action);

        if (isError) {
          hasError = true;
        }

        envResponses.push(output);

        if (isFinishAction(action)) {
          if (errors.length > 0) {
            envResponses.push('[INFO] Finish requested but parse errors were present. Please resolve errors, verify edits with a read-back, then try finish again.');
            hasError = true;
            break;
          }
          const finishAction = action as FinishAction;
          finishMessage = finishAction.message;

          done = true;
          winston.info(`Task finished: ${finishMessage}`);
          break;
        }

      } catch (error) {
        winston.error(`Action execution failed: ${error}`);
        envResponses.push(`[ERROR] Action execution failed: ${error}`);
        hasError = true;
      }
    }

    const subagentTrajectories = this.actionHandler.getAndClearSubagentTrajectories();

    return {
      actionsExecuted,
      envResponses,
      hasError,
      finishMessage,
      done,
      subagentTrajectories: Object.keys(subagentTrajectories).length > 0 ? subagentTrajectories : undefined,
    };
  }
}
