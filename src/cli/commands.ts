import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { ConfigManager } from '../core/config';
import { ConsoleLogger } from '../core/logger';
import { OpenRouterClient } from '../core/llm-client';
import { ToolRegistry } from '../tools';
import { AgentOrchestrator } from '../agents/orchestrator';
import * as fs from 'fs-extra';
import * as path from 'path';

export class DevRevCoderCLI {
  private config = ConfigManager.getInstance().getConfig();
  private logger = new ConsoleLogger(this.config);
  private toolRegistry = new ToolRegistry();
  private llmClient?: OpenRouterClient;
  private orchestrator?: AgentOrchestrator;

  private ensureOrchestrator(): AgentOrchestrator {
    if (!this.orchestrator) {
      this.llmClient = new OpenRouterClient(this.config, this.logger);
      this.orchestrator = new AgentOrchestrator(this.config, this.toolRegistry, this.llmClient, this.logger);
    }
    return this.orchestrator;
  }

  createProgram(): Command {
    const program = new Command();

    program
      .name('devrev-coder')
      .description('DevRev Coder Agent - AI-powered multi-agent coding system')
      .version('1.0.0');

    // Main command - interactive mode
    program
      .command('chat')
      .alias('c')
      .description('Start interactive chat with the coding agents')
      .option('-r, --repository <path>', 'Repository path', process.cwd())
      .option('-a, --agent <name>', 'Specific agent to use (CodingAgent, AnalysisAgent, PlanningAgent)')
      .option('-m, --multi-agent', 'Use multi-agent mode for complex tasks')
      .action(async (options) => {
        await this.handleChatCommand(options);
      });

    // One-shot command
    program
      .command('exec <request>')
      .alias('e')
      .description('Execute a single request')
      .option('-r, --repository <path>', 'Repository path', process.cwd())
      .option('-a, --agent <name>', 'Specific agent to use')
      .option('-m, --multi-agent', 'Use multi-agent mode')
      .option('-v, --verbose', 'Verbose output')
      .action(async (request, options) => {
        await this.handleExecCommand(request, options);
      });

    // Repository analysis
    program
      .command('analyze [path]')
      .description('Analyze repository structure and provide insights')
      .option('-d, --depth <number>', 'Analysis depth', '3')
      .option('-o, --output <format>', 'Output format (json|table|summary)', 'summary')
      .action(async (repositoryPath, options) => {
        await this.handleAnalyzeCommand(repositoryPath || process.cwd(), options);
      });

    // Agent management
    program
      .command('agents')
      .description('List available agents and their capabilities')
      .action(async () => {
        await this.handleAgentsCommand();
      });

    // Tool management
    program
      .command('tools')
      .description('List available tools')
      .option('-c, --category <type>', 'Filter by category (file|git|code|analysis)')
      .action(async (options) => {
        await this.handleToolsCommand(options);
      });

    // Configuration
    program
      .command('config')
      .description('Manage configuration')
      .option('-s, --show', 'Show current configuration')
      .option('-i, --init', 'Initialize configuration')
      .action(async (options) => {
        await this.handleConfigCommand(options);
      });

    return program;
  }

  private async handleChatCommand(options: any): Promise<void> {
    console.log(chalk.blue.bold('\n🤖 DevRev Coder Agent - Interactive Mode\n'));
    
    const repositoryPath = path.resolve(options.repository);
    if (!(await fs.pathExists(repositoryPath))) {
      this.logger.error('Repository path does not exist');
      return;
    }

    this.logger.info(`Repository: ${repositoryPath}`);
    
    // Show available agents
    if (!options.agent) {
      const agents = this.ensureOrchestrator().getAvailableAgents();
      console.log(chalk.cyan('\nAvailable Agents:'));
      agents.forEach((agent, index) => {
        console.log(chalk.white(`  ${index + 1}. ${chalk.bold(agent.name)} - ${agent.description}`));
      });
      console.log(chalk.gray('\nYou can specify an agent with -a flag, or let the system choose automatically.\n'));
    }

    const conversationHistory: any[] = [];

    while (true) {
      try {
        const { request } = await inquirer.prompt([
          {
            type: 'input',
            name: 'request',
            message: chalk.green('What would you like me to help you with?'),
            validate: (input) => input.trim().length > 0 || 'Please enter a request'
          }
        ]);

        if (request.toLowerCase() === 'exit' || request.toLowerCase() === 'quit') {
          console.log(chalk.yellow('\n👋 Goodbye!\n'));
          break;
        }

        if (request.toLowerCase() === 'clear') {
          console.clear();
          conversationHistory.length = 0;
          continue;
        }

        const spinner = ora('Processing your request...').start();

        try {
          let result;
          if (options.multiAgent) {
            spinner.text = 'Executing with multiple agents...';
            const results = await this.ensureOrchestrator().executeWithMultipleAgents(
              request, 
              repositoryPath, 
              conversationHistory
            );
            result = results[results.length - 1]; // Show the final result
          } else {
            result = await this.ensureOrchestrator().executeRequest(
              request, 
              repositoryPath, 
              conversationHistory
            );
          }

          spinner.stop();
          console.log('\n' + chalk.gray('─'.repeat(60)));
          
          if (result.success) {
            console.log(chalk.green('✅ Success\n'));
            console.log(result.message);
          } else {
            console.log(chalk.red('❌ Failed\n'));
            console.log(result.message);
          }

          // Update conversation history
          conversationHistory.push({
            role: 'user',
            content: request,
            timestamp: new Date()
          });
          conversationHistory.push({
            role: 'assistant',
            content: result.message,
            timestamp: new Date()
          });

          console.log('\n');
        } catch (error: any) {
          spinner.stop();
          this.logger.error(`Request failed: ${error.message}`);
        }
      } catch (error: any) {
        if (error.message.includes('User force closed')) {
          console.log(chalk.yellow('\n\n👋 Goodbye!\n'));
          break;
        }
        this.logger.error(`Error: ${error.message}`);
      }
    }
  }

  private async handleExecCommand(request: string, options: any): Promise<void> {
    const repositoryPath = path.resolve(options.repository);
    
    if (!(await fs.pathExists(repositoryPath))) {
      this.logger.error('Repository path does not exist');
      process.exit(1);
    }

    if (options.verbose) {
      console.log(chalk.blue.bold('\n🤖 DevRev Coder Agent - Execution Mode\n'));
      this.logger.info(`Repository: ${repositoryPath}`);
      this.logger.info(`Request: ${request}`);
    }

    const spinner = ora('Processing request...').start();

    try {
      let result;
      if (options.multiAgent) {
        spinner.text = 'Executing with multiple agents...';
        const results = await this.ensureOrchestrator().executeWithMultipleAgents(request, repositoryPath);
        result = results[results.length - 1];
      } else {
        result = await this.ensureOrchestrator().executeRequest(request, repositoryPath);
      }

      spinner.stop();

      if (result.success) {
        if (options.verbose) {
          console.log(chalk.green('\n✅ Success\n'));
        }
        console.log(result.message);
        process.exit(0);
      } else {
        if (options.verbose) {
          console.log(chalk.red('\n❌ Failed\n'));
        }
        console.error(result.message);
        process.exit(1);
      }
    } catch (error: any) {
      spinner.stop();
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  }

  private async handleAnalyzeCommand(repositoryPath: string, options: any): Promise<void> {
    const fullPath = path.resolve(repositoryPath);
    
    if (!(await fs.pathExists(fullPath))) {
      this.logger.error('Repository path does not exist');
      return;
    }

    const spinner = ora('Analyzing repository...').start();

    try {
      const result = await this.ensureOrchestrator().executeRequest(
        'Analyze this repository structure, technologies, and provide insights',
        fullPath
      );

      spinner.stop();

      if (options.output === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else if (options.output === 'table') {
        // Format as table - simplified for now
        console.log(chalk.blue.bold('\n📊 Repository Analysis\n'));
        console.log(result.message);
      } else {
        console.log(chalk.blue.bold('\n📊 Repository Analysis\n'));
        console.log(result.message);
      }
    } catch (error: any) {
      spinner.stop();
      this.logger.error(`Analysis failed: ${error.message}`);
    }
  }

  private async handleAgentsCommand(): Promise<void> {
    console.log(chalk.blue.bold('\n🤖 Available Agents\n'));
    
    const agents = this.ensureOrchestrator().getAvailableAgents();
    
    agents.forEach((agent, index) => {
      console.log(chalk.cyan.bold(`${index + 1}. ${agent.name}`));
      console.log(chalk.white(`   ${agent.description}\n`));
      
      console.log(chalk.gray('   Capabilities:'));
      agent.capabilities.forEach(capability => {
        console.log(chalk.gray(`   • ${capability}`));
      });
      console.log();
    });
  }

  private async handleToolsCommand(options: any): Promise<void> {
    console.log(chalk.blue.bold('\n🔧 Available Tools\n'));
    
    let tools;
    if (options.category) {
      tools = this.toolRegistry.getToolsByCategory(options.category as any);
      console.log(chalk.cyan(`Category: ${options.category.toUpperCase()}\n`));
    } else {
      tools = this.toolRegistry.getAllTools();
    }
    
    if (tools.length === 0) {
      console.log(chalk.yellow('No tools found for the specified category.'));
      return;
    }

    // Group tools by category for better display
    const grouped: Record<string, any[]> = {
      'File Operations': [],
      'Git Operations': [],
      'Code Analysis': [],
      'Other': []
    };

    tools.forEach(tool => {
      if (tool.name.startsWith('read_file') || tool.name.startsWith('write_file') || 
          tool.name.startsWith('list_directory') || tool.name.startsWith('search_files')) {
        grouped['File Operations'].push(tool);
      } else if (tool.name.startsWith('git_')) {
        grouped['Git Operations'].push(tool);
      } else if (tool.name.includes('analyze') || tool.name.includes('refactor')) {
        grouped['Code Analysis'].push(tool);
      } else {
        grouped['Other'].push(tool);
      }
    });

    Object.entries(grouped).forEach(([category, categoryTools]) => {
      if (categoryTools.length === 0) return;
      
      console.log(chalk.magenta.bold(category));
      categoryTools.forEach(tool => {
        console.log(chalk.white(`  • ${chalk.bold(tool.name)} - ${tool.description}`));
      });
      console.log();
    });
  }

  private async handleConfigCommand(options: any): Promise<void> {
    if (options.show) {
      console.log(chalk.blue.bold('\n⚙️  Current Configuration\n'));
      const config = ConfigManager.getInstance().getConfig();
      
      // Display config without sensitive data
      const displayConfig = {
        ...config,
        openRouter: {
          ...config.openRouter,
          apiKey: config.openRouter.apiKey ? '***masked***' : 'not set'
        }
      };
      
      console.log(JSON.stringify(displayConfig, null, 2));
      return;
    }

    if (options.init) {
      console.log(chalk.blue.bold('\n⚙️  Configuration Setup\n'));
      
      const template = ConfigManager.getInstance().createEnvTemplate();
      const envPath = path.join(process.cwd(), '.env');
      
      if (await fs.pathExists(envPath)) {
        const { overwrite } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'overwrite',
            message: '.env file already exists. Overwrite?',
            default: false
          }
        ]);
        
        if (!overwrite) {
          console.log(chalk.yellow('Configuration initialization cancelled.'));
          return;
        }
      }

      try {
        await fs.writeFile(envPath, template);
        console.log(chalk.green(`✅ Created .env file at ${envPath}`));
        console.log(chalk.yellow('\n⚠️  Please edit the .env file and add your OpenRouter API key.'));
      } catch (error: any) {
        this.logger.error(`Failed to create .env file: ${error.message}`);
      }
      return;
    }

    // Default: show help
    console.log(chalk.blue.bold('\n⚙️  Configuration Commands\n'));
    console.log(chalk.white('  --show    Show current configuration'));
    console.log(chalk.white('  --init    Initialize .env configuration file'));
  }
}
