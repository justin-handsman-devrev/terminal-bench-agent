import winston from 'winston';

export enum ErrorType {
  TRANSIENT = 'transient',      
  PERMISSION = 'permission',    
  NOT_FOUND = 'not_found',       
  SYNTAX = 'syntax',             
  PERMANENT = 'permanent',       
  UNKNOWN = 'unknown'
}

export interface ErrorClassification {
  type: ErrorType;
  isRetriable: boolean;
  suggestedWaitMs?: number;
  suggestion?: string;
}

export class ErrorClassifier {
  private static readonly ERROR_PATTERNS: Array<{
    pattern: RegExp;
    type: ErrorType;
    isRetriable: boolean;
    suggestion?: string;
  }> = [
    {
      pattern: /connection\s+(refused|reset|timed?\s*out)|network\s+unreachable|no\s+route\s+to\s+host/i,
      type: ErrorType.TRANSIENT,
      isRetriable: true,
      suggestion: 'Network connectivity issue. Will retry with backoff.'
    },
    {
      pattern: /temporary\s+failure|try\s+again|resource\s+temporarily\s+unavailable/i,
      type: ErrorType.TRANSIENT,
      isRetriable: true,
      suggestion: 'Temporary resource issue. Will retry.'
    },
    {
      pattern: /timeout|timed?\s*out/i,
      type: ErrorType.TRANSIENT,
      isRetriable: true,
      suggestion: 'Operation timed out. Consider increasing timeout or retrying.'
    },
    {
      pattern: /permission\s+denied|access\s+denied|operation\s+not\s+permitted|insufficient\s+privileges/i,
      type: ErrorType.PERMISSION,
      isRetriable: false,
      suggestion: 'Permission issue. Check file permissions or run with appropriate privileges.'
    },
    {
      pattern: /read-only\s+file\s+system/i,
      type: ErrorType.PERMISSION,
      isRetriable: false,
      suggestion: 'Filesystem is read-only. Cannot modify files in this location.'
    },
    {
      pattern: /command\s+not\s+found|no\s+such\s+file\s+or\s+directory|cannot\s+find/i,
      type: ErrorType.NOT_FOUND,
      isRetriable: false,
      suggestion: 'Resource not found. Check paths and command names.'
    },
    {
      pattern: /package\s+not\s+found|module\s+not\s+found|library\s+not\s+found/i,
      type: ErrorType.NOT_FOUND,
      isRetriable: false,
      suggestion: 'Missing dependency. May need to install required packages.'
    },
    {
      pattern: /syntax\s+error|parse\s+error|unexpected\s+token|invalid\s+syntax|indentationerror|unexpected\s+indent|expected\s+an\s+indented\s+block|compilation\s+failed|cannot\s+find\s+symbol|undeclared\s+identifier|expected\s+';'|missing\s+return\s+type|borrow\s+checker/i,
      type: ErrorType.SYNTAX,
      isRetriable: false,
      suggestion: 'Syntax or compilation error in code. Review and fix the syntax, missing imports, or type declarations.'
    },
    {
      pattern: /invalid\s+option|unknown\s+option|invalid\s+argument/i,
      type: ErrorType.SYNTAX,
      isRetriable: false,
      suggestion: 'Invalid command option or argument. Check command usage.'
    },
    {
      pattern: /out\s+of\s+memory|cannot\s+allocate\s+memory|memory\s+exhausted/i,
      type: ErrorType.TRANSIENT,
      isRetriable: true,
      suggestion: 'Memory exhaustion. May succeed after other processes free memory.'
    },
    {
      pattern: /no\s+space\s+left|disk\s+full|quota\s+exceeded/i,
      type: ErrorType.PERMANENT,
      isRetriable: false,
      suggestion: 'Disk space issue. Free up space before retrying.'
    },
    {
      pattern: /killed|terminated|segmentation\s+fault|core\s+dumped/i,
      type: ErrorType.PERMANENT,
      isRetriable: false,
      suggestion: 'Process crashed or was terminated. May indicate a bug or resource limit.'
    },
    {
      pattern: /broken\s+pipe|pipe\s+error/i,
      type: ErrorType.TRANSIENT,
      isRetriable: true,
      suggestion: 'Pipe communication error. May succeed on retry.'
    }
  ];

  static classifyError(error: string | Error, exitCode?: number): ErrorClassification {
    const errorMessage = typeof error === 'string' ? error : error.message;
  
    for (const { pattern, type, isRetriable, suggestion } of this.ERROR_PATTERNS) {
      if (pattern.test(errorMessage)) {
        return {
          type,
          isRetriable,
          suggestedWaitMs: isRetriable ? this.calculateBackoffMs(0) : undefined,
          suggestion
        };
      }
    }
    
    if (exitCode !== undefined) {
      switch (exitCode) {
        case 1:
          return {
            type: ErrorType.UNKNOWN,
            isRetriable: true,
            suggestedWaitMs: this.calculateBackoffMs(0),
            suggestion: 'General error. May succeed on retry.'
          };
        case 2:
          return {
            type: ErrorType.SYNTAX,
            isRetriable: false,
            suggestion: 'Command syntax error. Check command usage.'
          };
        case 126:
          return {
            type: ErrorType.PERMISSION,
            isRetriable: false,
            suggestion: 'Permission denied when executing command.'
          };
        case 127:
          return {
            type: ErrorType.NOT_FOUND,
            isRetriable: false,
            suggestion: 'Command not found. Check if the command is installed.'
          };
        case 130:
        case 137:
        case 143:
          return {
            type: ErrorType.PERMANENT,
            isRetriable: false,
            suggestion: 'Process was terminated by signal.'
          };
      }
    }
    
    return {
      type: ErrorType.UNKNOWN,
      isRetriable: exitCode === undefined || exitCode < 128,
      suggestedWaitMs: this.calculateBackoffMs(0),
      suggestion: 'Unclassified error. Retry may help.'
    };
  }

  static calculateBackoffMs(attemptNumber: number): number {
    const baseDelayMs = 1000;
    const maxDelayMs = 30000;
    const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attemptNumber), maxDelayMs);
    const jitter = Math.random() * 0.3 * exponentialDelay;
    return Math.floor(exponentialDelay + jitter);
  }

  static shouldRetry(
    error: string | Error, 
    exitCode?: number, 
    attemptNumber?: number,
    maxAttempts: number = 3
  ): { shouldRetry: boolean; waitMs?: number; reason?: string } {
    if (attemptNumber !== undefined && attemptNumber >= maxAttempts) {
      return { 
        shouldRetry: false, 
        reason: `Maximum retry attempts (${maxAttempts}) reached` 
      };
    }

    const classification = this.classifyError(error, exitCode);
    
    if (!classification.isRetriable) {
      return { 
        shouldRetry: false, 
        reason: classification.suggestion || 'Error is not retriable' 
      };
    }

    const waitMs = this.calculateBackoffMs(attemptNumber || 0);
    return {
      shouldRetry: true,
      waitMs,
      reason: classification.suggestion
    };
  }
}

export interface RetryConfig {
  maxAttempts?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  retryableErrors?: ErrorType[];
  onRetry?: (attempt: number, error: Error, waitMs: number) => void;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    onRetry = () => {},
  } = config;

  let lastError: Error;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      const { shouldRetry, waitMs, reason } = ErrorClassifier.shouldRetry(
        lastError,
        undefined,
        attempt,
        maxAttempts
      );

      if (!shouldRetry || attempt === maxAttempts - 1) {
        winston.debug(`Not retrying: ${reason}`);
        throw lastError;
      }

      winston.info(`Retry attempt ${attempt + 1}/${maxAttempts} after ${waitMs}ms. Reason: ${reason}`);
      onRetry(attempt, lastError, waitMs || 1000);
      
      await new Promise(resolve => setTimeout(resolve, waitMs || 1000));
    }
  }

  throw lastError!;
}
