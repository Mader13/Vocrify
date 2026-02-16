# Claude Flow MCP Server Setup

## ⚠️ ВАЖНО: Claude Flow - это внешний MCP сервер!

**НЕ встраивается в код приложения**  
**НЕ добавляется в `src/`**  
**Запускается как отдельный процесс через MCP**

## Что такое Claude Flow

Claude Flow - это MCP (Model Context Protocol) сервер, который расширяет возможности Claude Code:

- **60+ агентов** для разработки
- **Swarm координация** - множество агентов работают вместе  
- **Self-learning** - система учится на опыте
- **42+ skills** - готовые навыки (в папке `.claude/skills/`)

## Архитектура

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│ Claude Code │────▶│ MCP Server   │────▶│ Claude Flow  │
│  (вы здесь) │     │ (протокол)   │     │ (60+ агентов)│
└─────────────┘     └──────────────┘     └──────────────┘
                                               │
                                               ▼
                                        ┌──────────────┐
                                        │  .claude/    │
                                        │  skills/     │
                                        │  (наши 29    │
                                        │  навыков)    │
                                        └──────────────┘
```

## Установка

### Вариант 1: Через Claude Code CLI (рекомендуется)

```bash
# Добавить MCP сервер в Claude Code
claude mcp add claude-flow -- npx -y claude-flow@v3alpha mcp start

# Проверить установку
claude mcp list
```

### Вариант 2: Через конфигурационный файл

**Windows:**
```bash
# Открыть конфиг
notepad %APPDATA%\Claude\claude_desktop_config.json
```

**macOS:**
```bash
# Открыть конфиг
open ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Добавить в конфиг:**
```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["-y", "claude-flow@v3alpha", "mcp", "start"],
      "env": {
        "CLAUDE_FLOW_LOG_LEVEL": "info"
      }
    }
  }
}
```

## Использование

После установки MCP сервера, Claude Flow автоматически использует наши skills из `.claude/skills/`:

### Примеры команд:

```bash
# Анализ архитектуры
"Use v3-ddd-architecture to analyze src/stores/"

# Code review
"Use verification-quality to review VideoPlayer.tsx"

# Оптимизация
"Use v3-performance-optimization for device-specific tuning"
```

## Структура проекта (правильная)

```
transcribe-video/
├── src/                    # ✅ Приложение (React + Tauri)
│   └── ...
├── .claude/               # ✅ Навыки Claude Flow
│   └── skills/            #    (29 адаптированных навыков)
│       ├── v3-ddd-architecture/
│       ├── v3-deep-integration/
│       └── ...
├── AGENTS.md              # ✅ Контекст проекта
└── CLAUDE_FLOW_SETUP.md   # ✅ Этот файл
```

## Важно помнить

❌ **НЕ НАДО:**
- Создавать `claude-flow/` в корне проекта
- Импортировать `claude-flow` в `src/`
- Добавлять код Claude Flow в приложение

✅ **НАДО:**
- Установить MCP сервер через `claude mcp add`
- Использовать skills из `.claude/skills/`
- Работать через Claude Code с включенным MCP

## Документация

- [Claude Flow README](https://github.com/ruvnet/claude-flow)
- [MCP Documentation](https://modelcontextprotocol.io/)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)

## Проверка работы

1. Установите MCP сервер
2. Перезапустите Claude Code
3. Проверьте, что MCP индикатор (молоток) появился в Claude Code
4. Попробуйте команду: `"Use v3-ddd-architecture to analyze current codebase"`

## Готово!

Теперь Claude Flow работает как MCP сервер и использует наши 29 адаптированных skills для помощи в разработке TranscribeVideo.
