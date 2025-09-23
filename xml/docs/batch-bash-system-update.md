# Batch Bash Action - System Message Update

## Overview
A new `batch_bash` action has been added to improve performance when executing multiple bash commands. This action supports both parallel and sequential execution modes.

## System Message Addition

Add the following to the orchestrator and coder system messages:

### For Orchestrator (`orchestrator_sys_msg_v0.1.md`)

Add to the Actions section:

```markdown
#### batch_bash
Execute multiple bash commands either in parallel or sequentially with improved performance and error handling.

**Use when:**
- You need to run multiple independent commands (use parallel mode)
- You need to try multiple variations of a command (e.g., different passwords)
- You want better error handling and reporting for multiple commands

**Schema:**
```yaml
<batch_bash>
commands:
  - cmd: string          # The bash command to execute
    label: string        # Optional: Descriptive label for the command
    timeout: number      # Optional: Timeout in seconds (default: 120)
  - cmd: string
    label: string
    timeout: number
parallel: boolean        # Optional: Execute in parallel (default: true)
continueOnError: boolean # Optional: Continue if commands fail (default: true)
</batch_bash>
```

**Example - Parallel execution (faster for independent commands):**
```yaml
<batch_bash>
commands:
  - cmd: "find /app -name '*.py' | wc -l"
    label: "Count Python files"
  - cmd: "du -sh /app"
    label: "Check app size"
  - cmd: "ps aux | grep python"
    label: "List Python processes"
</batch_bash>
```

**Example - Sequential execution (for dependent commands):**
```yaml
<batch_bash>
parallel: false
commands:
  - cmd: "cd /tmp && git clone https://github.com/user/repo.git"
    label: "Clone repository"
  - cmd: "cd /tmp/repo && npm install"
    label: "Install dependencies"
  - cmd: "cd /tmp/repo && npm test"
    label: "Run tests"
</batch_bash>
```

**Performance tip:** When trying multiple passwords or variations, use parallel mode:
```yaml
<batch_bash>
continueOnError: true
commands:
  - cmd: "7z x -p'pass1' archive.7z -o/tmp/t1 -y 2>/dev/null && echo 'SUCCESS: pass1'"
  - cmd: "7z x -p'pass2' archive.7z -o/tmp/t2 -y 2>/dev/null && echo 'SUCCESS: pass2'"
  - cmd: "7z x -p'pass3' archive.7z -o/tmp/t3 -y 2>/dev/null && echo 'SUCCESS: pass3'"
</batch_bash>
```
```

### For Coder Agent (`coder_sys_msg_v0.1.md`)

Add a note in the bash section:

```markdown
**Note:** For executing multiple bash commands, consider using `batch_bash` action which supports parallel execution for better performance.
```

## Usage Guidelines

1. **Parallel Execution (Default)**
   - Use for independent commands that don't rely on each other
   - Significantly faster than sequential execution
   - All commands start at the same time

2. **Sequential Execution** 
   - Use when commands depend on previous results
   - Commands execute in order
   - Execution stops on error if `continueOnError: false`

3. **Error Handling**
   - `continueOnError: true` (default) - All commands run regardless of failures
   - `continueOnError: false` - Stops at first failure (sequential mode only)

4. **Performance Benefits**
   - Password cracking: Try multiple passwords simultaneously
   - File searching: Search multiple directories in parallel
   - System checks: Gather system info from multiple sources at once

## Migration Examples

### Before (Sequential bash actions):
```yaml
<bash>
cmd: "grep -r 'TODO' /app/src"
</bash>
<bash>
cmd: "grep -r 'FIXME' /app/src"
</bash>
<bash>
cmd: "grep -r 'BUG' /app/src"
</bash>
```

### After (Parallel batch_bash):
```yaml
<batch_bash>
commands:
  - cmd: "grep -r 'TODO' /app/src"
    label: "Find TODOs"
  - cmd: "grep -r 'FIXME' /app/src"
    label: "Find FIXMEs"
  - cmd: "grep -r 'BUG' /app/src"
    label: "Find BUGs"
</batch_bash>
```

## Implementation Notes

- Default timeout is 120 seconds per command
- Individual commands can override with their own timeout
- Output includes timing information for performance analysis
- Failed commands show error messages and exit codes
- Labels make output easier to understand
