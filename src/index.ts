import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { Command } from 'commander';
import { OrchestratorAgent } from './agents/orchestrator-agent';

import { LocalExecutor } from './core/execution/command-executor';
import { DockerExecutor } from './core/execution/docker-command-executor';
import { TerminalBenchExecutor } from './core/execution/terminal-bench-command-executor';
import { setupFileLogging } from './core/logging/logger';
import winston from 'winston';

const program = new Command();

program
  .name('multi-agent-coding-system')
  .description('TypeScript implementation of multi-agent AI coding system')
  .version('0.1.0');

program
  .command('run')
  .description('Run the orchestrator agent with a task')
  .argument('<task>', 'Task description to execute')
  .option('-c, --container <name>', 'Docker container name to execute in')
  .option('-m, --model <model>', 'LLM model to use', process.env.LITELLM_MODEL || 'moonshotai/kimi-k2:free')
  .option('-t, --temperature <temp>', 'Temperature for LLM', process.env.LITELLM_TEMPERATURE || '0.1')
  .option('--api-key <key>', 'API key for LLM', process.env.OPENROUTER_API_KEY || process.env.LITE_LLM_API_KEY || process.env.OPENAI_API_KEY)
  .option('--api-base <url>', 'API base URL', process.env.OPENROUTER_BASE_URL || process.env.LITE_LLM_API_BASE || process.env.OPENAI_BASE_URL)
  .option('--max-turns <turns>', 'Maximum turns before stopping', '50')
  .option('--log-level <level>', 'Logging level', 'INFO')
  .option('--log-dir <dir>', 'Directory for detailed logs', './logs')
  .option('--workdir <path>', 'Working directory for command execution (host for local, in-container path for docker)')
  .action(async (task: string, options) => {
    const logFile = setupFileLogging(options.logLevel, options.logDir);
    winston.info(`Logging to: ${logFile}`);

    let executor;
    if (options.container) {
      executor = new DockerExecutor(options.container, options.workdir || process.env.TB_WORKDIR || process.env.TERMINAL_BENCH_WORKDIR);
    } else if (process.env.TERMINAL_BENCH_SESSION === 'true') {
      winston.info('Detected Terminal-Bench environment, using TerminalBenchExecutor');
      executor = new TerminalBenchExecutor(options.workdir || process.env.TB_WORKDIR || process.env.TERMINAL_BENCH_WORKDIR);
    } else {
      executor = new LocalExecutor(options.workdir || process.env.TB_WORKDIR || process.env.TERMINAL_BENCH_WORKDIR);
    }

    const orchestrator = new OrchestratorAgent({
      model: options.model,
      temperature: parseFloat(options.temperature),
      apiKey: options.apiKey,
      apiBase: options.apiBase,
      loggingDir: options.logDir,
    });


    orchestrator.setup(executor, options.logDir);

    try {
      winston.info(`Starting task execution: ${task}`);
      winston.info(`Model: ${options.model || 'default'}`);
      winston.info(`Temperature: ${options.temperature}`);
      winston.info(`Max turns: ${options.maxTurns}`);

      const result = await orchestrator.run(task, parseInt(options.maxTurns));

      winston.info('\n' + '='.repeat(60));
      winston.info('EXECUTION RESULT:');
      winston.info('='.repeat(60));
      winston.info(`Completed: ${result.completed}`);
      winston.info(`Finish message: ${result.finishMessage || 'N/A'}`);
      winston.info(`Turns executed: ${result.turnsExecuted}`);
      winston.info(`Max turns reached: ${result.maxTurnsReached}`);

      const tokenUsage = orchestrator.getTokenUsage();
      winston.info(`Token usage - Input: ${tokenUsage.input}, Output: ${tokenUsage.output}`);

      process.exit(result.completed ? 0 : 1);

    } catch (error) {
      winston.error(`Fatal error during execution: ${error}`);
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Run a simple test to verify the system works')
  .option('-c, --container <name>', 'Docker container name to execute in')
  .option('-m, --model <model>', 'LLM model to use', process.env.LITELLM_MODEL)
  .option('--workdir <path>', 'Working directory for command execution (host for local, in-container path for docker)')
  .action(async (options) => {
    const logFile = setupFileLogging('INFO');
    winston.info(`Test logging to: ${logFile}`);

    let executor;
    if (options.container) {
      executor = new DockerExecutor(options.container, options.workdir || process.env.TB_WORKDIR || process.env.TERMINAL_BENCH_WORKDIR);
    } else if (process.env.TERMINAL_BENCH_SESSION === 'true') {
      winston.info('Detected Terminal-Bench environment, using TerminalBenchExecutor');
      executor = new TerminalBenchExecutor(options.workdir || process.env.TB_WORKDIR || process.env.TERMINAL_BENCH_WORKDIR);
    } else {
      executor = new LocalExecutor(options.workdir || process.env.TB_WORKDIR || process.env.TERMINAL_BENCH_WORKDIR);
    }

    const orchestrator = new OrchestratorAgent({
      model: options.model,
      temperature: 0.1,
    });

    orchestrator.setup(executor);

    try {
      const testTask = "Create a file called 'hello.txt' with content 'Hello, world!' and verify it was created correctly.";
      winston.info(`Running test task: ${testTask}`);

      const result = await orchestrator.run(testTask, 10);

      winston.info('\n' + '='.repeat(40));
      winston.info('TEST RESULT:');
      winston.info('='.repeat(40));
      winston.info(`Success: ${result.completed}`);
      winston.info(`Message: ${result.finishMessage || 'No message'}`);
      winston.info(`Turns: ${result.turnsExecuted}`);

      process.exit(result.completed ? 0 : 1);

    } catch (error) {
      winston.error(`Test failed: ${error}`);
      process.exit(1);
    }
  });

if (require.main === module) {
  program.parse();
}

export { OrchestratorAgent };
export * from './types';
export * from './core/execution/command-executor';
export * from './core/llm/client';
