# View Metrics Action - System Message Addition

## Overview
The `view_metrics` action allows agents to check their own performance metrics and adapt their behavior based on success rates and error patterns.

## System Message Addition

Add the following to the orchestrator system message (`orchestrator_sys_msg_v0.1.md`):

### In the Actions section:

```markdown
#### view_metrics
View performance metrics for executed actions. Useful for self-monitoring and adapting strategies based on what's working.

**Schema:**
```yaml
<view_metrics>
format: string  # Optional: 'summary' (default), 'detailed', or 'errors'
actionType: string  # Optional: Filter for specific action type (e.g., 'bash', 'read')
</view_metrics>
```

**Example - Check overall performance:**
```yaml
<view_metrics>
format: summary
</view_metrics>
```

**Example - Check bash command success rate:**
```yaml
<view_metrics>
format: summary
actionType: bash
</view_metrics>
```

**Example - Review recent errors:**
```yaml
<view_metrics>
format: errors
</view_metrics>
```

**Use when:**
- You notice repeated failures and want to understand patterns
- Before attempting a strategy that has failed before
- To check if a particular action type is experiencing issues
- For self-assessment during long-running tasks
```

### Add to Strategy Guidelines:

```markdown
## Performance Monitoring

Throughout task execution, periodically check your performance metrics:

1. If an action type has < 70% success rate, consider alternative approaches
2. Review error patterns to avoid repeating mistakes
3. Use metrics to inform strategy changes
4. Track improvement over time

Example adaptive behavior:
```yaml
# Check bash performance
<view_metrics>
format: summary
actionType: bash
</view_metrics>

# If success rate is low, be more careful with commands
# - Add more error checking
# - Use simpler commands
# - Verify prerequisites before execution
```
```

## For Subagents (Explorer and Coder)

Add a simpler note in their system messages:

```markdown
**Note:** You can use `<view_metrics>` to check your action success rates and recent errors if you notice repeated failures.
```

## Integration Examples

### Self-Monitoring Pattern

```yaml
# After several failures
<view_metrics>
format: errors
</view_metrics>

# Analyze the errors and adjust approach
<add_note>
content: "Bash commands failing due to missing dependencies. Need to check prerequisites first."
</add_note>
```

### Performance Check Before Major Operation

```yaml
# Before starting file edits
<view_metrics>
format: summary
actionType: edit
</view_metrics>

# If edit success rate is low, use more careful approach
# - Read files first
# - Make smaller edits
# - Verify changes after each edit
```

### Debugging Workflow

```yaml
# Task not progressing as expected
<view_metrics>
format: detailed
</view_metrics>

# Review which actions are taking longest
# Identify bottlenecks and optimize
```

## Benefits for Agents

1. **Self-Awareness**: Agents can recognize their own limitations
2. **Adaptive Strategy**: Change approach based on what's working
3. **Error Learning**: Avoid repeating the same mistakes
4. **Performance Optimization**: Focus on successful action patterns
5. **Debugging Aid**: Understand why tasks are failing

## Output Examples

### Summary Format
```
=== Action Metrics Summary ===
Total Actions: 45
Success Rate: 91.1%
Average Duration: 287ms

Top Actions by Usage:
  bash: 23 calls, 87.0% success
  read: 12 calls, 100.0% success
  grep: 6 calls, 83.3% success (degrading)
  edit: 4 calls, 100.0% success
```

### Errors Format
```
=== Recent Errors ===

[2025-09-19T15:45:23.123Z] bash (transient)
  Connection refused

[2025-09-19T15:44:12.456Z] grep (not_found)
  No matches found for pattern: config\.json

[2025-09-19T15:43:01.789Z] edit (syntax)
  Invalid YAML in edit operation
```

### Detailed Format
Full breakdown with:
- Per-action statistics
- Error distributions
- Performance trends
- Recommendations

## Best Practices

1. **Don't Over-Monitor**: Check metrics when you suspect issues, not after every action
2. **Act on Insights**: Use metrics to inform strategy changes
3. **Track Trends**: Look for improving/degrading patterns
4. **Context Matters**: Consider why certain actions might be failing

## Implementation Notes

- Metrics are collected automatically for all actions
- No performance impact on action execution
- Data persists across turns within a session
- Cleared when orchestrator is destroyed
