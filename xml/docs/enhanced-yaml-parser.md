# Enhanced YAML Parser with Error Recovery

## Overview

The terminal bench agent now includes an intelligent YAML parser that can automatically recover from common YAML syntax errors. This enhancement significantly improves the agent's ability to handle imperfect YAML input and provides helpful suggestions for fixing syntax issues.

## Features

### 1. Automatic Error Recovery

The parser automatically fixes common YAML mistakes:

- **Missing quotes** around values with special characters
- **Tabs to spaces** conversion
- **Trailing commas** removal (common JSON habit)
- **Missing spaces** after colons
- **Unclosed quotes** completion
- **Boolean/null case** sensitivity fixes (True → true, None → null)
- **List dash spacing** (- item → - item)
- **Empty values** handling
- **Backslash escaping** in values
- **Long strings** converted to block scalars

### 2. Aggressive Recovery Strategies

When standard recovery fails, the parser tries:

- **Simple key-value parsing**: Extracts basic key-value pairs even from malformed YAML
- **Command extraction**: For bash actions, attempts to extract just the command
- **Partial parsing**: Salvages what it can from broken YAML

### 3. Helpful Error Messages

When parsing fails, the parser provides:

- Specific recovery attempts made
- Contextual suggestions based on error type
- Action-specific examples
- Common YAML pitfalls to avoid

## Examples

### Before: Common YAML Mistakes

```xml
<bash>
cmd: echo "Hello: World"
block:true
timeoutSecs:60
</bash>
```

Issues:
- Missing space after `block:`
- Missing space after `timeoutSecs:`
- Unquoted string with special character

### After: Automatic Recovery

The parser automatically fixes these issues:
```yaml
cmd: "echo \"Hello: World\""
block: true
timeoutSecs: 60
```

### Example Recovery Messages

```
[bash] YAML error: end of the stream or a document separator is expected
RECOVERY: YAML parsing succeeded after: Adding quotes to values with special characters, Adding space after colons
HINT: The YAML content appears to be incomplete. Make sure to include all required fields.
Example:
  cmd: "ls -la"
  block: true
  timeoutSecs: 60
```

## Common Patterns Fixed

### 1. Tabs in Indentation
```yaml
# Before
	cmd: "ls"
	block: true

# After (automatic fix)
  cmd: "ls"
  block: true
```

### 2. Missing Quotes
```yaml
# Before
filePath: /path/with spaces/file.txt

# After (automatic fix)
filePath: "/path/with spaces/file.txt"
```

### 3. JSON-style Trailing Commas
```yaml
# Before
operations:
  - action: add,
    content: "test",

# After (automatic fix)
operations:
  - action: add
    content: "test"
```

### 4. Long Command Lines
```yaml
# Before
cmd: find /very/long/path -name "*.txt" -exec grep -l "pattern" {} \; | xargs -I {} cp {} /destination/

# After (automatic fix)
cmd: |
  find /very/long/path -name "*.txt" -exec grep -l "pattern" {} \; | xargs -I {} cp {} /destination/
```

## Benefits

1. **Reduced Failures**: Agents spend less time fixing YAML syntax errors
2. **Better Error Messages**: Clear guidance on what went wrong and how to fix it
3. **Learning Aid**: Helps agents learn correct YAML syntax through examples
4. **Graceful Degradation**: Even severely broken YAML can often be partially salvaged

## Implementation Details

### Recovery Process

1. **Initial Parse**: Try standard YAML parsing
2. **Pattern-Based Recovery**: Apply known fixes for common mistakes
3. **Re-parse After Each Fix**: Check if the fix resolved the issue
4. **Aggressive Recovery**: If still failing, try simpler parsing strategies
5. **Error Reporting**: Provide detailed feedback on what was tried

### Performance

- Minimal overhead for correct YAML (no recovery needed)
- Recovery typically adds <10ms for simple fixes
- Aggressive recovery may take up to 50ms for complex cases

## Best Practices

### For Agent Development

1. **Log Recovery Events**: Track which patterns are most common
2. **Update Patterns**: Add new recovery patterns as issues are discovered
3. **Test Edge Cases**: Ensure recovery doesn't break valid YAML

### For System Messages

1. **Show Examples**: Include correct YAML examples in error messages
2. **Explain Common Issues**: Help agents understand why errors occur
3. **Encourage Good Habits**: Promote proper YAML formatting from the start

## Error Classification

The parser classifies errors to provide better suggestions:

- **Indentation Errors**: Suggest consistent spacing
- **Unclosed Structures**: Identify missing closing elements
- **Invalid Characters**: Recommend quoting or escaping
- **Type Mismatches**: Suggest correct boolean/null format

## Future Enhancements

1. **Schema Validation**: Validate against expected action schemas
2. **Multi-language Support**: Handle YAML in different contexts
3. **Learning System**: Track and learn from common mistakes
4. **IDE Integration**: Real-time YAML validation in agent editors

## Troubleshooting

### Parser Not Recovering

1. Check if the YAML is severely malformed
2. Look for nested quote issues
3. Verify the action type is recognized

### False Positives

1. Some valid YAML might be "fixed" unnecessarily
2. Use block scalars (|) for complex strings
3. Quote values that should remain literal

### Performance Issues

1. Disable recovery for known-good YAML sources
2. Limit recovery attempts for very large YAML
3. Cache successful recovery patterns
