# Action Metrics and Performance Tracking

## Overview

The terminal bench agent now includes comprehensive action metrics collection and analysis. This system tracks the performance of every action executed, providing insights into:

- Success/failure rates by action type
- Execution time statistics
- Error patterns and trends
- Performance recommendations

## Features

### 1. Automatic Metrics Collection

Every action is automatically tracked with:
- **Action type** (bash, read, write, edit, grep, etc.)
- **Success/failure status**
- **Execution duration**
- **Error type classification** (if failed)
- **Contextual information** (command types, file extensions, etc.)

### 2. Metrics Persistence

Metrics are saved to disk in JSONL format:
- One file per day (e.g., `metrics_2025-09-19.jsonl`)
- Automatic flushing every 60 seconds
- Immediate flush on critical errors
- Bounded memory usage (max 1000 metrics in memory)

### 3. Trend Analysis

The system automatically detects performance trends:
- **Improving**: Success rate increasing over recent actions
- **Degrading**: Success rate decreasing
- **Stable**: No significant change

### 4. ViewMetrics Action

Agents can check their own performance using the `view_metrics` action:

```xml
<view_metrics>
format: summary
</view_metrics>
```

## Usage

### Command Line Options

```bash
# Metrics enabled by default
npm run start -- run "your task"

# Disable metrics collection
npm run start -- run "your task" --disable-metrics

# Custom metrics directory
npm run start -- run "your task" --metrics-dir ./custom-metrics
```

### ViewMetrics Action Formats

#### Summary Format (Default)
```xml
<view_metrics>
format: summary
</view_metrics>
```

Output:
```
=== Action Metrics Summary ===
Total Actions: 156
Success Rate: 94.2%
Average Duration: 342ms

Top Actions by Usage:
  bash: 89 calls, 92.1% success
  read: 34 calls, 100.0% success
  edit: 23 calls, 95.7% success (improving)
  grep: 10 calls, 90.0% success
```

#### Detailed Format
```xml
<view_metrics>
format: detailed
</view_metrics>
```

Provides full report with:
- Per-action breakdowns
- Error distribution
- Min/max/average durations
- Recent trends

#### Errors Format
```xml
<view_metrics>
format: errors
</view_metrics>
```

Shows recent errors with:
- Timestamp
- Action type
- Error type classification
- Error message

#### Filter by Action Type
```xml
<view_metrics>
format: summary
actionType: bash
</view_metrics>
```

Shows metrics for specific action type only.

## Metrics Data Structure

### ActionMetrics
```typescript
{
  actionType: "bash",
  success: true,
  duration: 245,  // milliseconds
  timestamp: "2025-09-19T14:30:00.000Z",
  errorType?: "transient",
  errorMessage?: "Connection refused",
  context?: {
    commandType: "curl",
    retryCount: 2
  }
}
```

### AggregatedMetrics
```typescript
{
  totalExecutions: 100,
  successCount: 95,
  failureCount: 5,
  successRate: 0.95,
  averageDuration: 300,
  minDuration: 50,
  maxDuration: 2000,
  errorDistribution: {
    "transient": 3,
    "not_found": 2
  },
  lastSuccess: "2025-09-19T14:30:00.000Z",
  lastFailure: "2025-09-19T14:25:00.000Z",
  recentTrend: "stable"
}
```

## Performance Recommendations

The system automatically generates recommendations based on patterns:

1. **Low Success Rate** (<50%)
   - "Consider using alternative approaches or investigating root cause"

2. **Degrading Performance**
   - "Recent performance degradation detected - monitor closely"

3. **Long Execution Times** (>10s average)
   - "Long execution time - consider optimization or parallel execution"

## Use Cases

### 1. Self-Monitoring
Agents can check their own performance during execution:

```xml
<!-- Check if bash commands are failing frequently -->
<view_metrics>
format: summary
actionType: bash
</view_metrics>

<!-- If success rate is low, try different approach -->
```

### 2. Error Analysis
When debugging failures:

```xml
<view_metrics>
format: errors
</view_metrics>
```

### 3. Performance Optimization
Identify slow operations:

```xml
<view_metrics>
format: detailed
</view_metrics>

<!-- Look for actions with high average duration -->
```

## Benefits

1. **Adaptive Behavior**: Agents can adjust strategies based on what's working
2. **Debugging Aid**: Clear visibility into failure patterns
3. **Performance Insights**: Identify bottlenecks and optimization opportunities
4. **Historical Analysis**: Track performance over time
5. **Error Pattern Recognition**: Understand common failure modes

## Implementation Details

### Memory Management
- Keeps only recent 1000 metrics in memory
- Older metrics persisted to disk
- Automatic cleanup of in-memory data

### File Format
Metrics stored as newline-delimited JSON (`.jsonl`):
```
{"actionType":"bash","success":true,"duration":245,"timestamp":"2025-09-19T14:30:00.000Z"}
{"actionType":"read","success":false,"duration":89,"timestamp":"2025-09-19T14:30:01.000Z","errorType":"not_found"}
```

### Performance Impact
- Minimal overhead: ~1-2ms per action
- Asynchronous file writes
- No impact on action execution

## Future Enhancements

1. **Predictive Analysis**: Predict likely failures before attempting
2. **Cross-Session Learning**: Learn from metrics across multiple runs
3. **Action Recommendations**: Suggest alternative actions based on success rates
4. **Visualization Dashboard**: Web UI for metrics analysis
5. **Alerts**: Notify on performance degradation

## Example Integration

In orchestrator agent:
```typescript
// Check performance before intensive operation
const bashSuccessRate = this.actionHandler.getActionSuccessRate('bash');
if (bashSuccessRate < 0.5) {
  // Consider alternative approach
  winston.warn('Bash commands have low success rate, being more careful');
}
```

## Troubleshooting

### Metrics Not Being Collected
1. Check if metrics are disabled: `--disable-metrics`
2. Verify write permissions to metrics directory
3. Check logs for metrics-related errors

### High Memory Usage
1. Reduce `maxInMemoryMetrics` if needed
2. Ensure metrics are being flushed to disk
3. Check for metrics file growth

### Performance Issues
1. Metrics collection adds minimal overhead
2. If issues persist, temporarily disable with `--disable-metrics`
3. Check disk I/O for metrics writes
