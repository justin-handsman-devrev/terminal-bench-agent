# DevRev Coder Agent 🤖

A sophisticated multi-agent AI coding system built with TypeScript that helps developers analyze, understand, and modify codebases using natural language instructions.

## 🌟 Features

- **Multi-Agent Architecture**: Specialized agents for different tasks (Coding, Analysis, Planning)
- **Intelligent Tool System**: Comprehensive set of tools for file operations, git management, and code analysis
- **Repository-Aware**: Automatically analyzes and understands your codebase structure
- **OpenRouter Integration**: Powered by state-of-the-art LLMs (Gemini 2.5 Flash by default)
- **Beautiful Terminal UI**: Colored output using Chalk with intuitive commands
- **Interactive & Batch Modes**: Chat interactively or execute single commands
- **Context-Aware Operations**: Maintains conversation history and repository context

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- OpenRouter API key ([Get one here](https://openrouter.ai/))

### Installation

```bash
# Clone or create the project
npm install

# Initialize configuration
npm run dev config --init

# Edit your .env file and add your OpenRouter API key
# OPENROUTER_API_KEY=your_api_key_here
```

### Build

```bash
# Build the project
npm run build

# Make globally available (optional)
npm link
```

## 📖 Usage

### Interactive Mode

Start a chat session with the AI agents:

```bash
# Basic interactive mode
devrev-coder chat

# Specify repository path
devrev-coder chat -r /path/to/your/project

# Use multi-agent mode for complex tasks
devrev-coder chat -m

# Specify a particular agent
devrev-coder chat -a CodingAgent
```

### One-Shot Execution

Execute single commands:

```bash
# Analyze a file
devrev-coder exec "Analyze the main.ts file and suggest improvements"

# Create a new feature
devrev-coder exec "Create a user authentication system with JWT tokens"

# Refactor code
devrev-coder exec "Refactor the UserService class to use dependency injection"
```

### Repository Analysis

Get insights about your codebase:

```bash
# Analyze current directory
devrev-coder analyze

# Analyze specific path
devrev-coder analyze /path/to/project

# Output as JSON
devrev-coder analyze -o json
```

### Agent Management

```bash
# List available agents
devrev-coder agents

# List available tools
devrev-coder tools

# Show tools by category
devrev-coder tools -c file
```

## 🤖 Available Agents

### CodingAgent
Specialized in writing, modifying, and fixing code.

**Capabilities:**
- Write new code files
- Modify existing code
- Fix bugs and issues
- Add tests and documentation
- Implement new features
- Apply coding best practices

### AnalysisAgent
Focused on understanding and analyzing codebases.

**Capabilities:**
- Analyze repository structure
- Identify code patterns and architectures
- Detect potential issues and improvements
- Generate code documentation
- Provide code quality metrics
- Suggest refactoring opportunities

### PlanningAgent
Strategic planning for complex development tasks.

**Capabilities:**
- Break down complex tasks into steps
- Create implementation roadmaps
- Analyze requirements and dependencies
- Estimate effort and complexity
- Identify risks and challenges
- Plan testing and validation strategies

## 🛠️ Available Tools

### File Operations
- `read_file`: Read file contents
- `write_file`: Write content to files
- `list_directory`: List directory contents
- `search_files`: Search for files matching patterns

### Git Operations
- `git_status`: Get repository status
- `git_diff`: Show changes
- `git_log`: View commit history
- `git_add`: Stage files
- `git_commit`: Create commits

### Code Analysis
- `analyze_code`: Extract code structure (functions, classes, imports)
- `refactor_code`: Apply safe code transformations

## ⚙️ Configuration

Configuration is managed through environment variables. Create a `.env` file:

```env
# OpenRouter Configuration (Required)
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=google/gemini-2.0-flash-experimental

# Agent Configuration
MAX_CONCURRENT_AGENTS=3
MAX_CONTEXT_LENGTH=100000
TEMPERATURE=0.1

# Tool Configuration
MAX_FILE_SIZE_KB=500
ENABLE_GIT_OPERATIONS=true
ENABLE_FILE_OPERATIONS=true

# Logging
LOG_LEVEL=info
LOG_TO_FILE=false
```

### Configuration Commands

```bash
# Show current configuration
devrev-coder config --show

# Initialize .env file
devrev-coder config --init
```

## 💡 Example Use Cases

### Code Analysis and Improvement

```bash
devrev-coder chat

# Example conversation:
> Analyze my React components and suggest performance improvements
> What security vulnerabilities can you find in my authentication system?
> Review my database queries for potential optimizations
```

### Feature Development

```bash
# Plan and implement a complete feature
devrev-coder exec "Plan and implement a REST API for user management with CRUD operations"

# Add specific functionality
devrev-coder exec "Add input validation and error handling to all API endpoints"
```

### Refactoring and Maintenance

```bash
# Code quality improvements
devrev-coder exec "Refactor the codebase to follow SOLID principles"

# Update dependencies
devrev-coder exec "Update all npm dependencies and fix any breaking changes"

# Add testing
devrev-coder exec "Add unit tests for all service classes with at least 80% coverage"
```

## 🏗️ Architecture

```
src/
├── agents/           # AI agents (Coding, Analysis, Planning)
├── tools/           # Available tools for agents
├── core/           # Core system components
│   ├── config.ts      # Configuration management
│   ├── logger.ts      # Logging system
│   ├── llm-client.ts  # OpenRouter integration
│   └── repository-analyzer.ts # Codebase analysis
├── cli/            # Command-line interface
├── types/          # TypeScript type definitions
└── utils/          # Utility functions
```

### Key Components

1. **Agent Orchestrator**: Manages agent selection and execution
2. **Tool Registry**: Manages available tools and their execution
3. **Repository Analyzer**: Understands codebase structure and context
4. **LLM Client**: Handles communication with OpenRouter API
5. **Configuration Manager**: Manages environment and runtime configuration

## 🎨 Terminal UI Features

- **Colored Output**: Different colors for different types of information
- **Progress Indicators**: Spinners and progress bars for long operations
- **Interactive Prompts**: User-friendly input collection
- **Formatted Tables**: Clean display of structured data
- **Error Handling**: Clear error messages with helpful suggestions

## 🔧 Development

```bash
# Install dependencies
npm install

# Development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Run linting
npm run lint

# Run tests
npm test
```

## 📝 API Usage

You can also use DevRev Coder Agent programmatically:

```typescript
import DevRevCoderAgent from 'devrev-coder-agent';

const agent = new DevRevCoderAgent({
  openRouter: {
    apiKey: 'your-api-key',
    model: 'google/gemini-2.0-flash-experimental'
  }
});

// Execute a single request
const result = await agent.executeRequest(
  'Analyze this file and suggest improvements',
  '/path/to/repository'
);

// Use multiple agents
const results = await agent.executeWithMultipleAgents(
  'Plan and implement a user authentication system',
  '/path/to/repository'
);

// Get agent recommendations
const recommendation = await agent.getAgentRecommendation(
  'I need to refactor my database layer'
);
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Troubleshooting

### Common Issues

1. **Missing API Key**: Run `devrev-coder config --init` and add your OpenRouter API key
2. **Permission Errors**: Make sure you have read/write permissions in the target directory
3. **Large Files**: Increase `MAX_FILE_SIZE_KB` in your configuration for larger files
4. **Rate Limits**: The system includes built-in rate limiting for API calls

### Getting Help

- Check the logs by setting `LOG_LEVEL=debug`
- Use `devrev-coder --help` for command help
- Review the examples above for common usage patterns

---

**Built with ❤️ using TypeScript, OpenRouter, and Chalk**
