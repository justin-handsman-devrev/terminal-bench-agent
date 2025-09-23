/**
 * Test suite for action parser functionality
 */

import { SimpleActionParser } from '../agents/actions/parsing/parser';
import {
  BashActionSchema,
  FinishActionSchema,
  BatchTodoActionSchema,
  ReadActionSchema,
  WriteActionSchema,
  EditActionSchema,
  isBashAction,
  isFinishAction,
  isBatchTodoAction,
  isReadAction,
} from '../agents/actions/entities/actions';

describe('SimpleActionParser', () => {
  let parser: SimpleActionParser;

  beforeEach(() => {
    parser = new SimpleActionParser();
  });

  describe('bash action parsing', () => {
    it('should parse basic bash command', async () => {
      const xml = `<bash>
cmd: "echo 'Hello World'"
</bash>`;

      const result = await parser.parseResponse(xml);
      
      expect(result.actions).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(result.foundActionAttempt).toBe(true);
      
      const action = result.actions[0];
      expect(isBashAction(action)).toBe(true);
      if (isBashAction(action)) {
        expect(action.cmd).toBe("echo 'Hello World'");
        expect(action.timeoutSecs).toBe(60); 
        expect(action.block).toBe(true); 
      }
    });

    it('should parse bash command with custom timeout', async () => {
      const xml = `<bash>
cmd: "sleep 5"
timeoutSecs: 10
</bash>`;

      const result = await parser.parseResponse(xml);
      const action = result.actions[0];
      
      expect(isBashAction(action)).toBe(true);
      if (isBashAction(action)) {
        expect(action.cmd).toBe("sleep 5");
        expect(action.timeoutSecs).toBe(10);
      }
    });

    it('should auto-sanitize and parse multi-line cmd as block scalar', async () => {
      const xml = `<bash>
cmd: python3 -c "print('start')"
import sys
print('middle')
print('end')
timeoutSecs: 15
</bash>`;

      const result = await parser.parseResponse(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      const action = result.actions[0];
      expect(isBashAction(action)).toBe(true);
      if (isBashAction(action)) {
        expect(action.timeoutSecs).toBe(15);
        // Ensure cmd contains the multi-line content converted into a single string
        expect(action.cmd).toContain("print('start')");
        expect(action.cmd).toContain("middle");
        expect(action.cmd).toContain("end");
      }
    });

    it('should auto-wrap single-line cmd containing colon-space (awk) into block scalar', async () => {
      const xml = `<bash>
cmd: awk -F',' 'NR==2 {for(i=1;i<=NF;i++) print "Column " i ": " $i}' /app/data.csv
timeoutSecs: 5
</bash>`;

      const result = await parser.parseResponse(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      const action = result.actions[0];
      expect(isBashAction(action)).toBe(true);
      if (isBashAction(action)) {
        expect(action.timeoutSecs).toBe(5);
        expect(action.cmd).toContain("Column ");
        expect(action.cmd).toContain(": ");
      }
    });
  });

  describe('todo batch operations', () => {
    it('should parse batch todo operations', async () => {
      const xml = `<todo>
operations:
  - action: add
    content: "Implement feature X"
  - action: add
    content: "Write tests for feature X"
  - action: complete
    taskId: 1
  - action: delete
    taskId: 2
viewAll: true
</todo>`;

      const result = await parser.parseResponse(xml);
      
      expect(result.actions).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      
      const action = result.actions[0];
      expect(isBatchTodoAction(action)).toBe(true);
      if (isBatchTodoAction(action)) {
        expect(action.operations).toHaveLength(4);
        expect(action.viewAll).toBe(true);
        
        const ops = action.operations;
        expect(ops[0].action).toBe('add');
        expect(ops[0].content).toBe('Implement feature X');
        expect(ops[2].action).toBe('complete');
        expect(ops[2].taskId).toBe(1);
      }
    });
  });

  describe('file operations', () => {
    it('should parse read action', async () => {
      const xml = `<file>
action: read
filePath: "/path/to/file.txt"
offset: 100
limit: 50
</file>`;

      const result = await parser.parseResponse(xml);
      const action = result.actions[0];
      
      expect(isReadAction(action)).toBe(true);
      if (isReadAction(action)) {
        expect(action.filePath).toBe('/path/to/file.txt');
        expect(action.offset).toBe(100);
        expect(action.limit).toBe(50);
      }
    });

    it('should parse write action with multi-line content', async () => {
      const xml = `<file>
action: write
filePath: "/tmp/output.txt"
content: |
  Line 1
  Line 2
  Line 3
</file>`;

      const result = await parser.parseResponse(xml);
      expect(result.actions).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept content with leading blank lines and not inject stray characters', async () => {
      const xml = `<file>
action: write
filePath: "/tmp/script.py"
content: |

  #!/usr/bin/env python3
  print('hello')
</file>`;

      const result = await parser.parseResponse(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
    });
  });

  describe('multiple actions in response', () => {
    it('should parse multiple actions', async () => {
      const xml = `
Let me help you with that task.

<bash>
cmd: "mkdir -p /tmp/test_dir"
</bash>

Now I'll create a file:

<file>
action: write
filePath: "/tmp/test_dir/README.md"
content: "# Test Project"
</file>

<finish>
message: "Setup completed"
</finish>
`;

      const result = await parser.parseResponse(xml);
      
      expect(result.actions).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(result.foundActionAttempt).toBe(true);
      
      expect(isBashAction(result.actions[0])).toBe(true);
      expect(isFinishAction(result.actions[2])).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should salvage invalid YAML in cmd by auto-wrapping into block scalar', async () => {
      const xml = `<bash>
cmd: this is not valid yaml
  because: indentation is wrong
</bash>`;

      const result = await parser.parseResponse(xml);
      
      expect(result.actions).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(result.foundActionAttempt).toBe(true);
    });

    it('should handle missing required fields', async () => {
      const xml = `<file>
action: write
content: "Missing filePath field"
</file>`;

      const result = await parser.parseResponse(xml);
      
      expect(result.actions).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('ignored tags', () => {
    it('should ignore non-action tags', async () => {
      const xml = `
<think>
This is my internal reasoning that should be ignored.
</think>

<reasoning>
More internal thoughts here.
</reasoning>

<bash>
cmd: "echo 'Only this should be parsed'"
</bash>

<plan_md>
# My plan
- Step 1
- Step 2
</plan_md>
`;

      const result = await parser.parseResponse(xml);
      
      expect(result.actions).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(isBashAction(result.actions[0])).toBe(true);
      if (isBashAction(result.actions[0])) {
        expect(result.actions[0].cmd).toBe("echo 'Only this should be parsed'");
      }
    });
  });

  describe('command fallback behavior', () => {
    it('should handle missing pip gracefully in action handler', async () => {
      // This is more of an integration test - we just verify the parser can handle
      // the fallback output format when the action handler tries alternatives
      const xml = `<bash>
cmd: pip install pandas
</bash>`;

      const result = await parser.parseResponse(xml);
      expect(result.errors).toHaveLength(0);
      expect(result.actions).toHaveLength(1);
      expect(isBashAction(result.actions[0])).toBe(true);
    });
  });
});
