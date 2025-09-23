# Batch Bash Action Example

The `batch_bash` action allows you to execute multiple bash commands either in parallel or sequentially, with improved performance and error handling.

## Basic Usage

### Parallel Execution (Default)
Execute multiple independent commands simultaneously:

```xml
<batch_bash>
commands:
  - cmd: "ls -la /app"
    label: "List app directory"
  - cmd: "df -h"
    label: "Check disk space"
  - cmd: "ps aux | grep python"
    label: "Check Python processes"
  - cmd: "date"
    label: "Current time"
</batch_bash>
```

### Sequential Execution
Execute commands one after another:

```xml
<batch_bash>
parallel: false
commands:
  - cmd: "cd /tmp && mkdir -p test_dir"
    label: "Create test directory"
  - cmd: "cd /tmp/test_dir && echo 'Hello' > file.txt"
    label: "Create file"
  - cmd: "cd /tmp/test_dir && cat file.txt"
    label: "Read file"
</batch_bash>
```

### With Error Handling
Continue execution even if some commands fail:

```xml
<batch_bash>
continueOnError: true
commands:
  - cmd: "echo 'This will succeed'"
    label: "Success command"
  - cmd: "false"  # This command always fails
    label: "Failing command"
  - cmd: "echo 'This will still run'"
    label: "Another success"
</batch_bash>
```

### With Custom Timeouts
Set individual timeouts for each command:

```xml
<batch_bash>
commands:
  - cmd: "sleep 2 && echo 'Quick command'"
    label: "2 second command"
    timeout: 5
  - cmd: "find / -name '*.log' 2>/dev/null | head -100"
    label: "Long running search"
    timeout: 30
  - cmd: "curl -s https://api.github.com/users/github"
    label: "API call"
    timeout: 10
</batch_bash>
```

## Performance Benefits

### Example: Password Cracking (Before)
Previously, the agent tried passwords sequentially:
```xml
<bash>
cmd: "7z x -p'password1' archive.7z"
</bash>
<bash>
cmd: "7z x -p'password2' archive.7z"
</bash>
<bash>
cmd: "7z x -p'password3' archive.7z"
</bash>
```

### Example: Password Cracking (After)
Now can try multiple passwords in parallel:
```xml
<batch_bash>
parallel: true
continueOnError: true
commands:
  - cmd: "7z x -p'password1' archive.7z -o/tmp/test1 -y 2>/dev/null && echo 'SUCCESS: password1'"
    label: "Try password1"
  - cmd: "7z x -p'password2' archive.7z -o/tmp/test2 -y 2>/dev/null && echo 'SUCCESS: password2'"
    label: "Try password2"
  - cmd: "7z x -p'password3' archive.7z -o/tmp/test3 -y 2>/dev/null && echo 'SUCCESS: password3'"
    label: "Try password3"
  - cmd: "7z x -p'password4' archive.7z -o/tmp/test4 -y 2>/dev/null && echo 'SUCCESS: password4'"
    label: "Try password4"
</batch_bash>
```

## Output Format

The batch_bash action provides detailed output including:
- Total execution time
- Execution mode (parallel/sequential)
- Number of commands and failures
- Individual command results with:
  - Duration
  - Exit code
  - Output
  - Error messages (if any)

Example output:
```
<batch_bash_output>
Batch execution completed in 2341ms
Mode: parallel
Commands: 4
Failures: 1
---

[1/4] List app directory
Duration: 15ms
Exit code: 0
Output:
total 64
drwxr-xr-x  8 root root 4096 Sep 19 14:10 .
drwxr-xr-x  1 root root 4096 Sep 19 14:10 ..

[2/4] Check disk space
Duration: 23ms
Exit code: 0
Output:
Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        20G  5.2G   14G  28% /

[3/4] Failed command
Duration: 10ms
Exit code: 1
Error: Command failed with exit code 1

[4/4] Current time
Duration: 8ms
Exit code: 0
Output:
Fri Sep 19 14:30:45 UTC 2025
</batch_bash_output>
```

## Best Practices

1. **Use parallel execution** for independent commands that don't depend on each other
2. **Use sequential execution** for commands that need to run in order
3. **Set appropriate timeouts** for long-running commands
4. **Use labels** to make output easier to understand
5. **Consider continueOnError** when you want to gather results from all commands regardless of failures
