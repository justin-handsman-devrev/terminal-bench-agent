#!/bin/bash

# Setup script for the TypeScript multi-agent system

echo "🚀 Setting up TypeScript Multi-Agent Coding System..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node --version)"
    exit 1
fi

echo "✅ Node.js $(node --version) detected"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build the project
echo "🔨 Building TypeScript project..."
npm run build

# Run tests
echo "🧪 Running tests..."
npm test

echo "✅ Setup complete!"
echo ""
echo "📚 Quick start:"
echo "  npm run dev run 'Create a hello world file'"
echo "  npm run dev test"
echo ""
echo "🔧 Configuration:"
echo "  Set OPENAI_API_KEY environment variable"
echo "  Optionally set OPENAI_BASE_URL for alternative providers"
echo ""
echo "📖 See README.md for more information"
