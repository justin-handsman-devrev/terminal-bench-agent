# Smart Error Recovery with Exponential Backoff

## Overview

The terminal bench agent now includes intelligent error recovery with automatic retry logic for transient failures. This enhancement classifies errors, determines if they're retriable, and applies exponential backoff with jitter for optimal retry timing.

## Features

### 1. Error Classification System

The `ErrorClassifier` automatically categorizes errors into:

- **TRANSIENT**: Network issues, timeouts, temporary unavailability (retriable)
- **PERMISSION**: Permission denied, access errors (not retriable)
- **NOT_FOUND**: File/command not found (not retriable)
- **SYNTAX**: Syntax errors, malformed commands (not retriable)
- **PERMANENT**: Permanent failures that won't resolve with retry (not retriable)
- **UNKNOWN**: Unclassified errors (sometimes retriable)

### 2. Automatic Retry Logic

For retriable errors, the system will:
- Automatically retry up to 3 times (configurable)
- Use exponential backoff with jitter (1s, 2s, 4s... up to 30s)
- Log retry attempts for transparency
- Provide detailed error analysis

### 3. Enhanced Error Messages

All errors now include:
- Error type classification
- Auto-analysis of the error
- Specific suggestions for resolution
- Retry information (if applicable)

## Configuration

### Enable/Disable Smart Retry

Smart retry is enabled by default. To disable:

```typescript
const orchestrator = new OrchestratorAgent({
  enableSmartRetry: false
});
```

### Configure Retry Attempts

```typescript
const orchestrator = new OrchestratorAgent({
  maxRetryAttempts: 5  // Default is 3
});
```

## Example Error Output

### Before (without smart retry):
```
<bash_output>
Exit code: 1
curl: (7) Failed to connect to api.example.com port 443: Connection refused

[SUGGESTION] Command failed. Try:
1. Run the command with verbose/debug flags
2. Check the command syntax and arguments
3. Look for more specific error messages in the output
</bash_output>
```

### After (with smart retry):
```
<bash_output>
Exit code: 1
curl: (7) Failed to connect to api.example.com port 443: Connection refused

[ERROR TYPE] TRANSIENT
[AUTO-ANALYSIS] Network connectivity issue. Will retry with backoff.
[SUGGESTION] Command failed. Try:
1. Run the command with verbose/debug flags
2. Check the command syntax and arguments
3. Look for more specific error messages in the output
[RETRY INFO] This error was automatically retried before failing.
</bash_output>
```

## Error Patterns Recognized

### Network/Connectivity
- Connection refused/reset/timeout
- Network unreachable
- No route to host
- Temporary DNS failures

### Resource Issues
- Resource temporarily unavailable
- Out of memory (sometimes retriable)
- Disk full (not retriable)
- Broken pipe

### Command/File Issues
- Command not found (not retriable)
- File not found (not retriable)
- Permission denied (not retriable)
- Syntax errors (not retriable)

### Process Issues
- Killed/terminated signals (not retriable)
- Segmentation faults (not retriable)
- Timeout errors (retriable)

## Implementation Details

### Retry Timing Algorithm

```typescript
calculateBackoffMs(attemptNumber: number): number {
  const baseDelayMs = 1000;
  const maxDelayMs = 30000;
  const exponentialDelay = Math.min(
    baseDelayMs * Math.pow(2, attemptNumber), 
    maxDelayMs
  );
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.floor(exponentialDelay + jitter);
}
```

### Commands Excluded from Retry

The following commands are never retried:
- `sleep` commands (intentional delays)
- `tail -f` commands (streaming logs)
- Background commands (non-blocking)

## Benefits

1. **Improved Reliability**: Transient network issues no longer cause immediate failures
2. **Better Error Context**: Agents get clearer information about why commands failed
3. **Reduced Manual Intervention**: Many temporary issues resolve automatically
4. **Optimal Retry Timing**: Exponential backoff prevents overwhelming failing services
5. **Selective Retry**: Only retriable errors trigger retry logic, saving time

## Usage in Actions

### Bash Actions
All bash commands automatically benefit from smart retry when enabled.

### File Operations
File operations (read/write) also use retry logic for:
- Network filesystem delays
- Temporary file locks
- Directory creation on slow filesystems

### Custom Retry Usage

For custom operations, you can use the `withRetry` function:

```typescript
import { withRetry } from './error-handler';

const result = await withRetry(
  async () => {
    // Your operation that might fail
    return await riskyOperation();
  },
  {
    maxAttempts: 5,
    onRetry: (attempt, error, waitMs) => {
      console.log(`Retry ${attempt + 1} after ${waitMs}ms`);
    }
  }
);
```

## Monitoring and Debugging

When retry occurs, you'll see log entries like:
```
INFO: Retrying bash command (attempt 1): curl https://api.ex...
DEBUG: Retry reason: Failed to connect to api.example.com port 443: Connection refused
INFO: Retry attempt 1/3 after 1248ms. Reason: Network connectivity issue. Will retry with backoff.
```

## Best Practices

1. **Keep smart retry enabled** for production use
2. **Monitor retry patterns** - frequent retries may indicate infrastructure issues
3. **Adjust timeouts** for commands that legitimately take longer
4. **Use batch_bash** with `continueOnError: true` for parallel retry scenarios
5. **Check error classifications** in logs to understand failure patterns
