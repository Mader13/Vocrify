# Hooks System - Fixed Issues

## Problems Found

### 1. Unstable Version CLI
**Issue:** `.claude/settings.json` and `.mcp.json` were using `@claude-flow/cli@latest` which pointed to `3.1.0-alpha.3` with a version bug.

**Error:** `npm error Invalid Version:`

**Fix:** Replaced all instances of `@latest` with `@3.0.2` (stable version)

### 2. ENAMETOOLONG Error
**Issue:** Commands were too long for Windows when executing hooks through the daemon.

**Location:** `.claude-flow/logs/headless/audit_*_error.log`

**Status:** This is a known Windows limitation. Hooks work when called directly but may fail when commands are too long.

### 3. Hooks Showing as "No" in List
**Issue:** `npx @claude-flow/cli@3.0.2 hooks list` shows all hooks as "No" in Enabled column.

**Reason:** Hooks are called directly via commands in `settings.json`, not registered in daemon. This is normal behavior.

## Current Status

✅ **Daemon Running**: PID 40768, HTTP API: http://localhost:3847
✅ **MCP Server Running**: PID 50376, Port 3000
✅ **Hooks Working**: Direct CLI calls work correctly
✅ **Metrics Active**: 128 commands executed, 94% success rate

## How Hooks Work

Hooks are triggered through `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{
          "type": "command",
          "command": "[ -n \"$TOOL_INPUT_file_path\" ] && npx @claude-flow/cli@3.0.2 hooks pre-edit --file \"$TOOL_INPUT_file_path\" 2>/dev/null || true",
          "timeout": 5000,
          "continueOnError": true
        }]
      }
    ]
  }
}
```

## Testing Hooks

Manual testing:
```bash
# Pre-edit hook
npx @claude-flow/cli@3.0.2 hooks pre-edit --file path/to/file.txt

# Post-edit hook
npx @claude-flow/cli@3.0.2 hooks post-edit --file path/to/file.txt --success true

# Route hook
npx @claude-flow/cli@3.0.2 hooks route --task "Fix authentication bug"

# Metrics
npx @claude-flow/cli@3.0.2 hooks metrics --v3-dashboard
```

## MCP Integration

Available MCP tools:
- `mcp__claude-flow__hooks_pre-edit`
- `mcp__claude-flow__hooks_post-edit`
- `mcp__claude-flow__hooks_pre-command`
- `mcp__claude-flow__hooks_post-command`
- `mcp__claude-flow__hooks_route`
- And more...

## Configuration Files

**`.claude/settings.json`**: Claude Code hooks configuration
**`.claude-flow/config.yaml`**: Daemon runtime configuration
**`.mcp.json`**: MCP server configuration

## Next Steps

1. Test automatic hook triggering during normal operations
2. Monitor logs: `.claude-flow/logs/headless/`
3. Check metrics dashboard: `npx @claude-flow/cli@3.0.2 hooks metrics --v3-dashboard`
4. Verify MCP integration is working with Claude Code

## Troubleshooting

**If hooks don't trigger:**
1. Check daemon is running: `npx @claude-flow/cli@3.0.2 process daemon --action status`
2. Check MCP server: `npx @claude-flow/cli@3.0.2 mcp status`
3. Review logs: `npx @claude-flow/cli@3.0.2 process logs --follow`
4. Verify settings.json has correct version: `grep -n "@claude-flow/cli" .claude/settings.json`

**Reinstalling stable version:**
```bash
npm uninstall @claude-flow/cli
npm install -g @claude-flow/cli@3.0.2
```
