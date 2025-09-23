# 🤓 Multi-Agent Coding System (TypeScript)

## Overview

This is a TypeScript port of the Python multi-agent orchestrator system. The system consists of:

- **Orchestrator Agent**: Strategic coordinator that manages tasks and delegates to subagents
- **Explorer Agent**: Read-only investigation and verification specialist  
- **Coder Agent**: Implementation specialist with write access
- **Context Store**: Persistent knowledge sharing between agents
- **Action System**: Comprehensive framework for agent-environment interaction

## Architecture

The system employs a hierarchical multi-agent architecture where:
- The **Orchestrator** acts as the task manager and coordinator
- **Subagents** are specialized workers for specific task types (exploration or coding)
- Communication happens through structured reports and context sharing
- A **Context Store** enables knowledge persistence and sharing across agent interactions

## Key Features

- **Smart Context Sharing**: Agents build and share knowledge artifacts through a persistent context store
- **Task Management**: Comprehensive tracking of multi-step workflows with failure recovery
- **Time-Conscious Orchestration**: Efficient delegation with precise task scoping
- **Action-First Design**: All capabilities expressed as discrete, validated actions
- **Forced Completion**: Ensures task termination with fallback mechanisms

## Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Testing

```bash
npm test
```

## Project Structure

```
src/
├── agents/                     # Agent implementations
│   ├── orchestrator/          # Orchestrator agent
│   ├── subagents/            # Explorer and Coder agents
│   ├── actions/              # Action system
│   └── state/                # State management
├── core/                      # Core utilities
│   ├── llm/                  # LLM client
│   ├── execution/            # Command execution
│   └── logging/              # Logging utilities
└── types/                     # TypeScript type definitions
```

## Configuration

### OpenRouter (Recommended)
OpenRouter provides access to multiple LLM providers through a single API:

```bash
export OPENROUTER_API_KEY="your-openrouter-key"
export LITELLM_MODEL="anthropic/claude-3.5-sonnet"  # or any OpenRouter model
export LITELLM_TEMPERATURE="0.1"
```

### Direct OpenAI
```bash
export OPENAI_API_KEY="your-openai-key"
export LITELLM_MODEL="gpt-4"
export LITELLM_TEMPERATURE="0.1"
```

### Other Providers (LiteLLM Compatible)
```bash
export LITE_LLM_API_KEY="your-api-key"
export LITE_LLM_API_BASE="your-api-base-url"
export LITELLM_MODEL="your-model-name"
```

### Popular Model Examples
```bash
# Anthropic Claude via OpenRouter
export LITELLM_MODEL="anthropic/claude-3.5-sonnet"

# OpenAI GPT-4 via OpenRouter  
export LITELLM_MODEL="openai/gpt-4"

# Google Gemini via OpenRouter
export LITELLM_MODEL="google/gemini-pro"

# Qwen Coder via OpenRouter
export LITELLM_MODEL="qwen/qwen-2.5-coder-32b-instruct"
```

## License

MIT
