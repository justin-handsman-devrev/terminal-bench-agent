#!/bin/bash

# Terminal-Bench Runner Script
# This script can be run from any directory and will properly set up the environment

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Set up Python path to include the agent directory
export PYTHONPATH="$SCRIPT_DIR:$PYTHONPATH"

# Change to the agent directory to ensure proper working directory
cd "$SCRIPT_DIR"

# Run terminal-bench with the provided arguments
tb run \
    --dataset terminal-bench-core==head \
    --agent-import-path ts_agent_wrapper:TypeScriptAgentWrapper \
    "$@"
