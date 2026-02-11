#!/bin/bash
# Claude Flow MCP Server Setup Script
# Run this to configure Claude Flow MCP server for TranscribeVideo project

echo "=========================================="
echo "Claude Flow MCP Server Setup"
echo "=========================================="
echo ""

# Check if Claude Code is installed
if ! command -v claude &> /dev/null; then
    echo "❌ Claude Code not found!"
    echo "Install it first: npm install -g @anthropic-ai/claude-code"
    exit 1
fi

echo "✅ Claude Code found"
echo ""

# Add Claude Flow MCP server
echo "Adding Claude Flow MCP server..."
claude mcp add claude-flow -- npx -y claude-flow@v3alpha mcp start

echo ""
echo "✅ Claude Flow MCP server added!"
echo ""

# Verify installation
echo "Verifying installation..."
claude mcp list

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Restart Claude Code if it's running"
echo "2. Look for MCP indicator (🔨) in Claude Code input"
echo "3. Try: 'Use v3-ddd-architecture to analyze src/stores/'"
echo ""
echo "Available skills in .claude/skills/:"
ls -1 .claude/skills/ | head -10
echo "... and more!"
