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
    const { actions, errors, foundActionAttempt } = await this.actionParser.parseResponse(llmOutput);

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
          if (errors.length > 0 || hasError) {
            envResponses.push('[INFO] Finish requested but errors are present (parse or tool). Resolve errors, verify edits via read-back, then finish.');
            hasError = true;
            break;
          }

          if (this.actionHandler.hasCodeChanges()) {
            winston.info('Code changes detected, running build/test validation...');
            const [validationOutput, hasCriticalError] = await this.actionHandler.runBuildValidation();
            envResponses.push(validationOutput);
            
            if (hasCriticalError) {
              envResponses.push('[INFO] Finish blocked - CRITICAL build/compilation errors found. Please fix syntax errors, missing imports, or compilation failures before finishing.');
              hasError = true;
              break;
            }
            
            if (validationOutput.includes('[WARNING]')) {
              envResponses.push('[INFO] Build validation completed with warnings - these are non-critical issues (linting, style, etc.). Proceeding with finish.');
            } else {
              envResponses.push('[INFO] Build/test validation passed - proceeding with finish.');
            }
            this.actionHandler.clearCodeChangeTracking();
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
