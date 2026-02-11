# ✅ Claude Flow Setup - ИСПРАВЛЕНО

## Что было неправильно:

❌ **Мы сделали:**
1. Создали `claude-flow/` директорию в проекте
2. Написали код интеграции в `src/services/`
3. Думали, что Claude Flow — это библиотека для импорта

## Что правильно:

✅ **Claude Flow — это MCP сервер (внешний процесс)**

```
❌ НЕПРАВИЛЬНО:                    ✅ ПРАВИЛЬНО:
┌──────────────┐                 ┌──────────────┐
│  Application │                 │  Application │
│   (React)    │                 │   (React)    │
│     +        │                 └──────────────┘
│ claude-flow  │                        │
│   (import)   │                 ┌───────▼──────┐
└──────────────┘                 │ Claude Code  │
                                        │
                                 ┌──────▼───────┐
                                 │ MCP Protocol │
                                 └──────┬───────┘
                                        │
                                 ┌──────▼───────┐
                                 │ Claude Flow  │
                                 │ MCP Server   │
                                 │ (npx process)│
                                 └──────────────┘
```

## Что мы оставили:

✅ **`.claude/skills/`** — 29 адаптированных навыков (это правильно!)  
✅ **`AGENTS.md`** — контекст проекта для AI  

## Что нужно сделать теперь:

### 1. Установить MCP сервер (одна команда):

```bash
claude mcp add claude-flow -- npx -y claude-flow@v3alpha mcp start
```

Или запустить скрипт:
```bash
bash setup-claude-flow-mcp.sh
```

### 2. Перезапустить Claude Code

### 3. Начать использовать skills:

```
"Use v3-ddd-architecture to analyze src/stores/"
```

## Итоговая структура:

```
transcribe-video/
├── src/                          # ✅ Приложение (чистое!)
│   ├── components/
│   ├── stores/
│   └── services/                 #    (без claude-flow!)
│
├── .claude/                      # ✅ Навыки для MCP сервера
│   └── skills/                   #    (29 штук)
│       ├── v3-ddd-architecture/
│       ├── v3-deep-integration/
│       └── ...
│
├── AGENTS.md                     # ✅ Контекст проекта
├── CLAUDE_FLOW_MCP_SETUP.md      # ✅ Инструкция по установке
└── setup-claude-flow-mcp.sh      # ✅ Скрипт установки
```

## Главное правило:

**Claude Flow ≠ код приложения**  
**Claude Flow = MCP сервер + skills**

Теперь всё правильно! 🎉
