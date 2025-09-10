#!/usr/bin/env node

import { DevRevCoderCLI } from './cli/commands';
import chalk from 'chalk';

async function main() {
  try {
    // Display banner
    console.log(chalk.blue.bold(`
    ██████╗ ███████╗██╗   ██╗██████╗ ███████╗██╗   ██╗
    ██╔══██╗██╔════╝██║   ██║██╔══██╗██╔════╝██║   ██║
    ██║  ██║█████╗  ██║   ██║██████╔╝█████╗  ██║   ██║
    ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══██╗██╔══╝  ╚██╗ ██╔╝
    ██████╔╝███████╗ ╚████╔╝ ██║  ██║███████╗ ╚████╔╝
    ╚═════╝ ╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝  ╚═══╝
    
    ╔═══════════════════════════════════════════════════╗
    ║        🤖 CODER AGENT - AI Development Assistant   ║
    ║              Multi-Agent Coding System           ║
    ╚═══════════════════════════════════════════════════╝
    `));

    const cli = new DevRevCoderCLI();
    const program = cli.createProgram();
    
    await program.parseAsync(process.argv);
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    
    // Show helpful error messages
    if (error.message.includes('OPENROUTER_API_KEY')) {
      console.log(chalk.yellow('💡 Tip: Run `devrev-coder config --init` to set up your configuration.'));
    }
    
    process.exit(1);
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error(chalk.red('\n❌ Uncaught Exception:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('\n❌ Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);
  process.exit(1);
});

// Handle SIGINT (Ctrl+C) gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Goodbye!\n'));
  process.exit(0);
});

if (require.main === module) {
  main();
}
