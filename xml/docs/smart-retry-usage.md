# Smart Retry Usage Guide

## Enabling Smart Retry

Smart retry is **enabled by default** for all new orchestrator instances. No configuration needed!

### Command Line Usage

When running the terminal bench agent:

```bash
# Smart retry enabled by default
npm run start -- run "extract password from archive.7z"

# Explicitly disable smart retry
npm run start -- run "extract password from archive.7z" --disable-smart-retry

# Configure retry attempts
npm run start -- run "extract password from archive.7z" --max-retries 5
```

### Programmatic Usage

```typescript
import { OrchestratorAgent } from './agents/orchestrator-agent';
import { LocalExecutor } from './core/execution/command-executor';

// Default configuration (smart retry enabled)
const orchestrator = new OrchestratorAgent();

// Explicitly configure smart retry
const orchestratorWithConfig = new OrchestratorAgent({
  enableSmartRetry: true,    // Default: true
  maxRetryAttempts: 5        // Default: 3
});

// Disable smart retry
const orchestratorNoRetry = new OrchestratorAgent({
  enableSmartRetry: false
});
```

## Smart Retry in Action

### Example 1: Network Timeout

Without smart retry:
```
Turn 1: curl https://slow-api.example.com/data
Result: Connection timeout (fails immediately)
Turn 2: [Agent tries different approach...]
```

With smart retry:
```
Turn 1: curl https://slow-api.example.com/data
- Attempt 1: Connection timeout
- Wait 1.2s (with jitter)
- Attempt 2: Connection timeout  
- Wait 2.4s (with jitter)
- Attempt 3: Success! (API recovered)
Result: Data retrieved successfully
```

### Example 2: File System Operations

```yaml
<bash>
cmd: "cp /network-mount/large-file.zip /local/destination/"
</bash>
```

If the network mount temporarily disconnects:
- Attempt 1: "Input/output error"
- System waits with exponential backoff
- Attempt 2: Success when mount recovers

## When Smart Retry Helps

1. **CI/CD Environments**
   - Package registry timeouts
   - Docker pull temporary failures
   - Test infrastructure hiccups

2. **Network Operations**
   - API calls with intermittent connectivity
   - Downloads from unstable sources
   - Cloud service temporary unavailability

3. **File Systems**
   - Network-attached storage delays
   - Temporary file locks
   - Permission propagation delays

4. **Container Operations**
   - Docker daemon temporary issues
   - Container startup race conditions
   - Resource allocation delays

## Retry Behavior by Error Type

| Error Type | Retriable | Example | Wait Time |
|------------|-----------|---------|-----------|
| Network Timeout | ✅ Yes | "Connection timed out" | 1s → 2s → 4s |
| DNS Failure | ✅ Yes | "Temporary failure in name resolution" | 1s → 2s → 4s |
| Permission Denied | ❌ No | "Permission denied" | No retry |
| File Not Found | ❌ No | "No such file or directory" | No retry |
| Syntax Error | ❌ No | "Syntax error near unexpected token" | No retry |
| Out of Memory | ✅ Yes | "Cannot allocate memory" | 1s → 2s → 4s |
| Disk Full | ❌ No | "No space left on device" | No retry |

## Performance Impact

Smart retry adds minimal overhead:
- Non-failing commands: **0ms** additional time
- Retriable failures: Up to `sum(backoff times)` additional
- Non-retriable failures: **<1ms** for classification

## Monitoring Retries

Look for these patterns in logs:

```
INFO: Retrying bash command (attempt 1): curl https://api.example.com
DEBUG: Retry reason: Connection refused
INFO: Retry attempt 1/3 after 1248ms. Reason: Network connectivity issue.
```

Frequent retries may indicate:
- Infrastructure issues
- Underprovisioned resources  
- Network instability
- Service degradation

## Best Practices

1. **Leave it enabled** - There's virtually no downside
2. **Monitor retry patterns** - They reveal infrastructure issues
3. **Adjust max attempts** for critical operations
4. **Use batch_bash** for parallel retries
5. **Check classifications** to understand failures

## Advanced Configuration

### Per-Command Retry Control

While not directly supported in individual bash commands, you can:

1. Use `batch_bash` with single command and custom settings
2. Temporarily disable retry for specific operations
3. Implement custom retry logic in scripts

### Integration with Task Profiles

Different task profiles can have different retry settings:

```typescript
const PRODUCTION_PROFILE = {
  maxRetryAttempts: 5,      // More retries for production
  enableSmartRetry: true,
};

const DEVELOPMENT_PROFILE = {
  maxRetryAttempts: 2,      // Fewer retries for faster feedback
  enableSmartRetry: true,
};
```

## Troubleshooting

### Retries Not Working?

1. Check if smart retry is enabled
2. Verify the error is classified as retriable
3. Check max attempts hasn't been exceeded
4. Look for "[RETRY INFO]" in error output

### Too Many Retries?

1. Reduce `maxRetryAttempts`
2. Fix underlying infrastructure issues
3. Consider if the operation should be retriable

### Want More Detailed Logs?

Set log level to DEBUG to see retry classifications:
```bash
npm run start -- run "your task" --log-level DEBUG
```
