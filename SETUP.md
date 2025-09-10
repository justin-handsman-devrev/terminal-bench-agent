# DevRev Coder Agent - Setup Guide

## Quick Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Build the Project**
   ```bash
   npm run build
   ```

3. **Initialize Configuration**
   ```bash
   npm run dev config --init
   ```
   
   Then edit the created `.env` file and add your OpenRouter API key:
   ```env
   OPENROUTER_API_KEY=your_actual_api_key_here
   ```

4. **Test the System**
   ```bash
   # Interactive mode
   npm run dev chat
   
   # Or direct execution
   npm run dev exec "Analyze this repository structure"
   ```

## Architecture Overview

The DevRev Coder Agent is a sophisticated multi-agent AI system with the following components:

### 🧠 Core System
- **ConfigManager**: Handles environment variables and configuration
- **OpenRouterClient**: Integrates with OpenRouter API for LLM calls  
- **ConsoleLogger**: Beautiful terminal logging with Chalk colors
- **RepositoryAnalyzer**: Analyzes codebase structure and technologies

### 🤖 Agents
- **CodingAgent**: Writes, modifies, and fixes code
- **AnalysisAgent**: Analyzes codebases and provides insights
- **PlanningAgent**: Creates detailed implementation plans
- **AgentOrchestrator**: Manages agent selection and execution

### 🛠️ Tool System
- **File Operations**: read_file, write_file, list_directory, search_files
- **Git Operations**: git_status, git_diff, git_log, git_add, git_commit
- **Code Analysis**: analyze_code, refactor_code

### 🖥️ CLI Interface
- Interactive chat mode with conversation history
- One-shot command execution
- Repository analysis
- Agent and tool management
- Configuration setup

## Key Features

✅ **Multi-Agent Architecture**: Different agents for different tasks
✅ **Context-Aware**: Understands repository structure and history
✅ **Tool Integration**: Comprehensive set of development tools
✅ **Beautiful UI**: Colored terminal output with Chalk
✅ **OpenRouter Integration**: Uses Gemini 2.5 Flash model
✅ **Structured Output**: Field names and data types included
✅ **Rate Limiting**: Built-in API rate limiting
✅ **Error Handling**: Graceful error handling and recovery
✅ **Extensible**: Easy to add new agents and tools

## Example Usage

```bash
# Start interactive mode
devrev-coder chat

# Analyze a repository
devrev-coder analyze /path/to/repo

# Execute specific tasks
devrev-coder exec "Add unit tests to the UserService class"
devrev-coder exec "Refactor the authentication system to use JWT"
devrev-coder exec "Create a new API endpoint for user profiles"

# Use multi-agent mode for complex tasks
devrev-coder chat -m
```

## Memory Integration

The system remembers user preferences:
- Uses Gemini 2.5 flash model with OpenRouter
- Provides structured output with field names and data types
- Includes pretty-print options for tabular display

## Development Commands

```bash
npm run build        # Compile TypeScript
npm run dev         # Run in development mode with hot reload
npm run lint        # Run ESLint
npm test            # Run tests
npm run clean       # Clean build artifacts
```

## Environment Variables

Create a `.env` file with these variables:

```env
# Required
OPENROUTER_API_KEY=your_api_key

# Optional (with defaults)
OPENROUTER_MODEL=google/gemini-2.0-flash-experimental
MAX_CONCURRENT_AGENTS=3
MAX_CONTEXT_LENGTH=100000
TEMPERATURE=0.1
MAX_FILE_SIZE_KB=500
ENABLE_GIT_OPERATIONS=true
ENABLE_FILE_OPERATIONS=true
LOG_LEVEL=info
LOG_TO_FILE=false
```

The system is fully functional and ready to use! 🚀
