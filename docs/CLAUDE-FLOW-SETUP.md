# Claude Flow V3 Setup Guide

Complete setup guide for Claude Flow V3 advanced features. This document configures:
- Neural Networks (pattern learning)
- Security scanning
- Hooks system (self-learning)
- Code analysis
- Performance monitoring
- Embeddings (semantic search)
- Guidance Control Plane
- Q-Learning routing
- Process management

## Prerequisites

- Node.js 20+
- Bun (recommended)
- Python 3.8-3.12 (if using AI features)
- Claude Code CLI v2.1.20+

## Step 1: Install Claude Flow

```bash
# Install via bun (recommended)
bunx @claude-flow/cli@latest doctor

# Or globally
bun install -g @claude-flow/cli@latest
```

## Step 2: Initialize Project

```bash
# Navigate to your project
cd /path/to/your/project

# Initialize Claude Flow with full configuration
bunx @claude-flow/cli@latest init --full --start-daemon

# Or minimal setup
bunx @claude-flow/cli@latest init --minimal
```

## Step 3: Initialize Swarm

```bash
# Initialize swarm with hierarchical topology
bunx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 15 --strategy specialized
```

## Step 4: Setup Neural Networks

```bash
# Check neural system status
bunx @claude-flow/cli@latest neural status

# List available pre-trained models
bunx @claude-flow/cli@latest neural list

# Import pre-trained patterns from IPFS
bunx @claude-flow/cli@latest neural import --cid QmNr1yYMKi7YBaL8JSztQyuB5ZUaTdRMLxJC1pBpGbjsTc

# Train neural patterns on your codebase
bunx @claude-flow/cli@latest neural train -p your-project-name --src src/,src-tauri/,ai-engine/

# Check learned patterns
bunx @claude-flow/cli@latest neural patterns --action list

# Status after training:
# - ReasoningBank: 50+ patterns stored
# - SONA Coordinator: Active
# - Flash Attention: Available
# - Int8 Quantization: Available
```

## Step 5: Setup Security Scanning

```bash
# Run initial security scan
bunx @claude-flow/cli@latest security scan --target . --quick

# For comprehensive scan
bunx @claude-flow/cli@latest security scan --target . --depth advanced

# Check for CVE vulnerabilities
bunx @claude-flow/cli@latest security cve --list

# Run threat modeling
bunx @claude-flow/cli@latest security threats

# Scan for secrets in codebase
bunx @claude-flow/cli@latest security secrets

# Expected output: 0 critical, 0 high, 0 medium vulnerabilities
```

## Step 6: Setup Hooks System

```bash
# Initialize hooks with full configuration
bunx @claude-flow/cli@latest init hooks --full

# Run pretrain on your repository (4-step pipeline)
bunx @claude-flow/cli@latest hooks pretrain

# Expected results:
# - Files Analyzed: 50-100+
# - Patterns Extracted: 20-40
# - Strategies Learned: 10-20
# - Trajectories Evaluated: 30-60

# Generate optimized agent configs from pretrain data
bunx @claude-flow/cli@latest hooks build-agents

# View learning metrics dashboard
bunx @claude-flow/cli@latest hooks metrics --v3-dashboard
```

## Step 7: Setup Code Analysis

```bash
# Analyze code complexity (find files with complexity > 15)
bunx @claude-flow/cli@latest analyze complexity src/ --threshold 15

# Analyze code using AST parsing
bunx @claude-flow/cli@latest analyze ast src/

# Extract code symbols (functions, classes, types)
bunx @claude-flow/cli@latest analyze symbols src/ --type function

# Analyze import dependencies
bunx @claude-flow/cli@latest analyze imports src/ --external

# Find circular dependencies
bunx @claude-flow/cli@latest analyze circular src/

# Detect module boundaries using MinCut algorithm
bunx @claude-flow/cli@latest analyze boundaries src/

# Build full dependency graph
bunx @claude-flow/cli@latest analyze dependencies src/ --format dot

# Check dependency vulnerabilities
bunx @claude-flow/cli@latest analyze deps --security
```

## Step 8: Setup Performance Monitoring

```bash
# Run performance benchmarks
bunx @claude-flow/cli@latest performance benchmark --quick

# For comprehensive benchmarking
bunx @claude-flow/cli@latest performance benchmark

# Profile application performance
bunx @claude-flow/cli@latest performance profile

# Identify performance bottlenecks
bunx @claude-flow/cli@latest performance bottleneck

# View performance metrics
bunx @claude-flow/cli@latest performance metrics

# Expected targets:
# - Embedding Generation: < 5ms
# - Flash Attention: < 1ms
# - SONA Adaptation: < 0.05ms
# - Memory Store+Embed: < 50ms
```

## Step 9: Setup Embeddings

```bash
# Initialize embedding subsystem with ONNX model
bunx @claude-flow/cli@latest embeddings init

# Or with larger model
bunx @claude-flow/cli@latest embeddings init --model all-mpnet-base-v2

# Generate embeddings for text
bunx @claude-flow/cli@latest embeddings generate -t "Your text here"

# Semantic similarity search
bunx @claude-flow/cli@latest embeddings search -q "authentication patterns"

# Compare similarity between texts
bunx @claude-flow/cli@latest embeddings compare -t "auth" -u "login"

# List available embedding models
bunx @claude-flow/cli@latest embeddings models

# Warmup embedding model for faster operations
bunx @claude-flow/cli@latest embeddings warmup
```

## Step 10: Setup Guidance Control Plane

```bash
# Compile CLAUDE.md into policy bundle
bunx @claude-flow/cli@latest guidance compile

# Optimize CLAUDE.md for better structure and coverage
bunx @claude-flow/cli@latest guidance optimize

# Apply optimizations (dry run by default)
bunx @claude-flow/cli@latest guidance optimize --apply

# Retrieve task-relevant guidance
bunx @claude-flow/cli@latest guidance retrieve -t "Fix authentication bug"

# Check enforcement gates
bunx @claude-flow/cli@latest guidance gates -c "rm -rf node_modules"

# Show guidance status
bunx @claude-flow/cli@latest guidance status

# Expected score: 70-85/100 (B grade)
```

## Step 11: Setup Q-Learning Routing

```bash
# List all available agent types
bunx @claude-flow/cli@latest route list-agents

# Route task to optimal agent
bunx @claude-flow/cli@latest route "Implement feature X"

# Check Q-Learning statistics
bunx @claude-flow/cli@latest route stats

# Provide feedback on routing decision
bunx @claude-flow/cli@latest route feedback --task-id 123 --rating 5

# Export Q-table for persistence
bunx @claude-flow/cli@latest route export -o q-table.json

# Import Q-table from file
bunx @claude-flow/cli@latest route import -i q-table.json

# Expected agents: 8 types (coder, tester, reviewer, architect, etc.)
```

## Step 12: Setup Process Management

```bash
# Check daemon status
bunx @claude-flow/cli@latest process daemon --action status

# Start daemon
bunx @claude-flow/cli@latest process daemon --action start

# List all workers
bunx @claude-flow/cli@latest process workers --action list

# Trigger specific worker manually
bunx @claude-flow/cli@latest process daemon --action trigger --worker map
bunx @claude-flow/cli@latest process daemon --action trigger --worker audit
bunx @claude-flow/cli@latest process daemon --action trigger --worker optimize

# Real-time monitoring
bunx @claude-flow/cli@latest process monitor --watch

# View process logs
bunx @claude-flow/cli@latest process logs --follow

# Available workers:
# - map: Codebase mapping (5 min interval)
# - audit: Security analysis (10 min interval)
# - optimize: Performance optimization (15 min interval)
# - consolidate: Memory consolidation (30 min interval)
# - testgaps: Test coverage analysis (20 min interval)
# - predict: Predictive preloading (2 min, disabled by default)
```

## Step 13: Verify Setup

```bash
# Run comprehensive health check
bunx @claude-flow/cli@latest doctor

# Check memory statistics
bunx @claude-flow/cli@latest memory stats

# List stored memories
bunx @claude-flow/cli@latest memory list

# Check neural status
bunx @claude-flow/cli@latest neural status

# Check system status
bunx @claude-flow/cli@latest status
```

## Step 14: Configure API Keys (Optional)

```bash
# Configure providers for AI features
bunx @claude-flow/cli@latest providers configure -p anthropic
bunx @claude-flow/cli@latest providers configure -p openai

# Test provider connectivity
bunx @claude-flow/cli@latest providers test --all

# List available providers
bunx @claude-flow/cli@latest providers list
```

## Verification Checklist

After completing all steps, verify:

- [ ] Claude Flow initialized
- [ ] Swarm active (hierarchical topology, 15 agents max)
- [ ] Neural patterns trained (50+ patterns)
- [ ] Security scan complete (0 critical vulnerabilities)
- [ ] Hooks pretrain done (30+ patterns, 16+ strategies)
- [ ] Code analysis run (complexity, AST, dependencies)
- [ ] Performance benchmark complete (all targets met)
- [ ] Embeddings initialized (ONNX model loaded)
- [ ] Guidance compiled (3+ rules, 70+ score)
- [ ] Q-Learning routing ready (8 agents)
- [ ] Process management active (daemon running)
- [ ] Doctor check passes (9+ passed, <5 warnings)

## Quick Reference Commands

```bash
# Daily workflow
bunx @claude-flow/cli@latest doctor                          # Health check
bunx @claude-flow/cli@latest neural status                    # Check neural
bunx @claude-flow/cli@latest memory search -q "pattern"      # Search memory
bunx @claude-flow/cli@latest route "task description"        # Route task
bunx @claude-flow/cli@latest hooks route -t "task"           # Route with hooks

# Code analysis
bunx @claude-flow/cli@latest analyze complexity src/         # Complexity
bunx @claude-flow/cli@latest analyze circular src/           # Circular deps
bunx @claude-flow/cli@latest security scan                    # Security

# Performance
bunx @claude-flow/cli@latest performance benchmark            # Benchmark
bunx @claude-flow/cli@latest performance bottleneck          # Bottlenecks
```

## Troubleshooting

### Neural training fails
```bash
# Check if source paths exist
ls src/, src-tauri/

# Try with single directory
bunx @claude-flow/cli@latest neural train -p project --src src/
```

### Embeddings initialization fails
```bash
# Use default model
bunx @claude-flow/cli@latest embeddings init

# Skip if not critical (memory search still works)
```

### Security scan takes too long
```bash
# Use quick mode
bunx @claude-flow/cli@latest security scan --target . --quick
```

### Hooks pretrain slow
```bash
# Reduce scope
bunx @claude-flow/cli@latest hooks pretrain --src src/ --max-files 50
```

## Next Steps

After setup:
1. Run daily: `bunx @claude-flow/cli@latest doctor`
2. Store patterns: `bunx @claude-flow/cli@latest memory store --key "pattern" --value "description"`
3. Use routing: `bunx @claude-flow/cli@latest route "your task"`
4. Monitor performance: `bunx @claude-flow/cli@latest performance benchmark`

## Support

- Claude Flow Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
- Doctor command: `bunx @claude-flow/cli@latest doctor --fix`
