# Claude Flow V3 - Quick Reference Card

## Daily Workflow (5 commands)

```bash
# Health check
bunx @claude-flow/cli@latest doctor

# Neural status
bunx @claude-flow/cli@latest neural status

# Memory stats
bunx @claude-flow/cli@latest memory stats

# Security scan
bunx @claude-flow/cli@latest security scan --target . --quick

# Route task
bunx @claude-flow/cli@latest route "your task description"
```

## Code Analysis (3 commands)

```bash
# Complexity (find files > 15)
bunx @claude-flow/cli@latest analyze complexity src/ --threshold 15

# Circular dependencies
bunx @claude-flow/cli@latest analyze circular src/

# Security scan
bunx @claude-flow/cli@latest security scan --target .
```

## Intelligent Search (2 commands)

```bash
# Semantic search (find similar code)
bunx @claude-flow/cli@latest embeddings search -q "pattern"

# Memory search (find past solutions)
bunx @claude-flow/cli@latest memory search --query "problem"
```

## Development Workflow (3 commands)

```bash
# Get context before editing
bunx @claude-flow/cli@latest hooks pre-edit -f src/App.tsx

# Route to optimal agent
bunx @claude-flow/cli@latest hooks route -t "implement feature"

# Get guidance for task
bunx @claude-flow/cli@latest guidance retrieve -t "task description"
```

## Performance (2 commands)

```bash
# Benchmark
bunx @claude-flow/cli@latest performance benchmark

# Find bottlenecks
bunx @claude-flow/cli@latest performance bottleneck
```

## Troubleshooting (3 commands)

```bash
# Check system
bunx @claude-flow/cli@latest status

# Full diagnostics
bunx @claude-flow/cli@latest doctor --fix

# View logs
bunx @claude-flow/cli@latest process logs --follow
```

## One-Liners

```bash
# Store pattern
bunx @claude-flow/cli@latest memory store -k "key" -v "value" -n patterns

# Get AI prediction
bunx @claude-flow/cli@latest neural predict -t "task"

# Check CVE vulnerabilities
bunx @claude-flow/cli@latest security cve --list

# List learned patterns
bunx @claude-flow/cli@latest neural patterns --action list

# Compare two texts
bunx @claude-flow/cli@latest embeddings compare -t "text1" -u "text2"

# Check if command is safe
bunx @claude-flow/cli@latest guidance gates -c "command"

# View routing stats
bunx @claude-flow/cli@latest route stats

# List available agents
bunx @claude-flow/cli@latest route list-agents
```

## Performance Targets

| Operation | Target | Actual |
|-----------|--------|--------|
| Embedding Generation | < 5ms | 3.95ms ✅ |
| Flash Attention | < 1ms | 0.110ms ✅ |
| SONA Adaptation | < 0.05ms | 2.75μs ✅ |
| Memory Store+Embed | < 50ms | 31.8ms ✅ |

## System Status

- **Neural Patterns**: 50+ learned
- **Security**: 0 vulnerabilities
- **Hooks**: 30+ patterns, 16+ strategies
- **Guidance Score**: 81/100 (B grade)
- **Agents**: 8 types available
- **Memory**: HNSW indexed (150x-12,500x faster)

## Full Documentation

- Setup Guide: `docs/CLAUDE-FLOW-SETUP.md`
- Main Docs: `CLAUDE.md`
- GitHub: https://github.com/ruvnet/claude-flow
