# Claude Flow V3 - Полный Гайд Использования

## 📋 Что такое Claude Flow?

**Claude Flow** - это система оркестрации multi-agent AI для Claude Code с:
- **99+ специализированных агентов** (coder, tester, security, devops и др.)
- **Swarm координация** (hierarchical-mesh топология)
- **Self-learning** (ReasoningBank с HNSW индексацией)
- **Memory Database** (AgentDB с векторным поиском)
- **Hooks система** (автоматическая оптимизация workflows)
- **MCP интеграция** (расширенные инструменты)

## 🚀 Текущий статус системы

```
✅ Глобальная установка: v3.1.0-alpha.3
✅ Локальная инициализация: выполнена
✅ Daemon: ЗАПУЩЕН (PID: 54520)
✅ Memory: Инициализирована
✅ Swarm: Инициализирован (hierarchical-mesh, max 15 agents)
✅ Skills: 29 скиллов доступны
✅ Agents: 99 агентов доступны
✅ MCP: Настроен в .mcp.json
```

## 📁 Структура проекта

```
.claude-flow/
├── config.yaml          # Конфигурация системы
├── data/                # База данных памяти
├── logs/                # Логи системы
├── sessions/            # Сессии агентов
└── daemon.log           # Логи daemon

.claude/
├── skills/              # 29 скиллов для Claude Code
│   ├── swarm-orchestration/
│   ├── agentdb-advanced/
│   ├── v3-*/
│   └── github-*/
├── agents/              # 99 конфигураций агентов
│   ├── development/     # Backend, frontend, testing
│   ├── specialized/     # Security, performance, DevOps
│   ├── analysis/        # Code review, architecture
│   └── custom/          # Custom agents
├── commands/            # 10 команд
├── helpers/             # Helper scripts
└── settings.json        # Hooks и permissions

.mcp.json                # MCP сервер конфигурация
```

## 🎯 Основные способы использования

### 1. Через CLI (командная строка)

#### Базовые команды:
```bash
# Статус системы
claude-flow status

# Запуск системы
claude-flow start

# Остановка системы
claude-flow stop

# Daemon управление
claude-flow daemon start
claude-flow daemon status
claude-flow daemon stop
```

#### Работа с агентами:
```bash
# Список доступных агентов
ls .claude/agents/development/
ls .claude/agents/specialized/

# Создание задачи (пример)
claude-flow task create \
  -t implementation \
  -d "Implement user authentication API"

# Просмотр задач
claude-flow task list
```

#### Memory операции:
```bash
# Поиск по памяти
claude-flow memory search -q "API patterns"

# Сохранение в память
claude-flow memory store \
  --namespace patterns \
  --key auth-flow \
  --value "JWT implementation"
```

### 2. Через Claude Code (Skills & Hooks)

#### Автоматический routing:
Claude Flow автоматически анализирует твои запросы через hooks в `.claude/settings.json`:

```json
"UserPromptSubmit": [{
  "command": "npx @claude-flow/cli@latest hooks route --task \"$PROMPT\""
}]
```

Когда ты пишешь запрос, Claude Flow:
1. Анализирует тип задачи
2. Находит подходящего агента
3. Применяет релевантные паттерны из памяти
4. Выполняет с правильным контекстом

#### Использование Skills:
В Claude Code доступны 29 скиллов:
- `swarm-orchestration` - Multi-agent координация
- `agentdb-advanced` - Продвинутый поиск по AgentDB
- `v3-swarm-coordination` - V3 swarm оптимизация
- `github-*` - GitHub интеграции
- И еще 24...

### 3. Через MCP (расширенные возможности)

MCP сервер предоставляет дополнительные инструменты через `.mcp.json`:
- AgentDB операции
- Memory management
- Swarm координация
- Neural training
- Security scanning

## 💡 Практическое применение

### Пример 1: Backend API разработка

**Ты просишь:**
> "Создай REST API для управления пользователями с аутентификацией"

**Что делает Claude Flow автоматически:**
1. **Route hook** определяет тип задачи → backend-dev agent
2. **Pre-task hook**:
   - Ищет похожие API implementations в памяти (HNSW поиск)
   - Находит лучшие паттерны (reward > 0.85)
   - Изучает прошлые ошибки
3. **Agent execution**:
   - Применяет лучшие практики
   - Использует GNN-enhanced search для зависимостей
   - Flash Attention для больших схем (4-7x быстрее)
4. **Post-task hook**:
   - Запускает тесты
   - Сохраняет паттерн в ReasoningBank
   - Обучает neural network если успешно

### Пример 2: Code Review & Security

**Ты просишь:**
> "Проверь код на уязвимости и оптимизируй"

**Claude Flow:**
1. **Route** → security + performance agents
2. **Parallel execution** через swarm
3. **AgentDB search** для похожих уязвлений
4. **CVE database check**
5. **Threat modeling**
6. **Store patterns** для будущего обучения

### Пример 3: Multi-agent координация

**Ты просишь:**
> "Сделай fullstack feature с backend, frontend и тестами"

**Claude Flow:**
1. **Swarm coordination** (hierarchical-mesh)
2. **Spawn agents**: backend-dev, frontend-dev, test-unit
3. **Pipeline execution**:
   ```
   backend-dev → frontend-dev → test-unit → integration-test
   ```
4. **Memory sharing** между агентами
5. **Load balancing** задач
6. **Fault tolerance** с retry логикой

## 🔧 Daemon Workers

Daemon автоматически запускает фоновые workers:

```bash
Worker Status
+-------------+----+----------+------+---------+
| Worker      | On | Status   | Runs | Success |
+-------------+----+----------+------+---------+
| map         | ✓  | idle     | 1    | 100%    |
| audit       | ✓  | idle     | 1    | 100%    |
| optimize    | ✓  | idle     | 0    | 0%      |
| consolidate | ✓  | idle     | 0    | 0%      |
| testgaps    | ✓  | idle     | 0    | 0%      |
+-------------+----+----------+------+---------+
```

**Workers:**
- **map** - Картографирует кодbase
- **audit** - Аудит кода на проблемы
- **optimize** - Оптимизация производительности
- **consolidate** - Консолидация дубликатов
- **testgaps** - Поиск пробелов в тестах
- **predict** - Предсказание задач (disabled)
- **document** - Авто-документация (disabled)

## 🎓 Как я (Claude) буду использовать Claude Flow

### 1. Перед любой задачей:
```javascript
// Автоматически через hooks:
1. Поиск похожих задач в памяти
2. Применение успешных паттернов
3. Изучение прошлых ошибок
4. GNN-enhanced context search
```

### 2. Во время выполнения:
```javascript
1. Flash Attention для больших файлов (4-7x быстрее)
2. AgentDB для умного поиска зависимостей
3. Swarm координация для параллельных задач
4. Memory sharing между агентами
```

### 3. После выполнения:
```javascript
// Автоматически через hooks:
1. Сохранение паттернов в ReasoningBank
2. Оценка качества (reward 0.0-1.0)
3. Neural training на успешных паттернах
4. Обновление AgentDB индекса
```

## 🚀 Quick Start команды

```bash
# 1. Проверка статуса
claude-flow status

# 2. Просмотр логов
tail -f .claude-flow/daemon.log

# 3. Memory поиск
claude-flow memory search -q "твой запрос"

# 4. Просмотр agents
ls .claude/agents/

# 5. Просмотр skills
ls .claude/skills/

# 6. Daemon status
claude-flow daemon status

# 7. Просмотр сессий
ls .claude-flow/sessions/
```

## 📊 Мониторинг и оптимизация

### Просмотр метрик:
```bash
# Agent performance
claude-flow agent metrics

# Swarm status
claude-flow swarm status

# Memory stats
claude-flow memory stats

# System health
claude-flow doctor
```

### Оптимизация:
```bash
# Оптимизация memory index
claude-flow memory optimize

# Консолидация дубликатов
claude-flow memory consolidate

# Очистка старых сессий
claude-flow session cleanup
```

## 🎯 Best Practices

1. **Начинай с малого** - используй 2-3 агента, масштабируй по необходимости
2. **Доверяй memory** - пусть Claude Flow учится на твоих задачах
3. **Используй hooks** - они автоматически оптимизируют workflows
4. **Мониторь daemon** - следи за worker status
5. **Сохраняй паттерны** - успешные решения будут переиспользованы
6. **Проверяй логи** - `.claude-flow/logs/` содержит детальную информацию

## 🔍 Troubleshooting

### Daemon не запускается:
```bash
claude-flow daemon stop
claude-flow daemon start
```

### Memory не работает:
```bash
claude-flow memory init --force
```

### Swarm проблемы:
```bash
claude-flow swarm init --topology hierarchical-mesh
```

### Логи для отладки:
```bash
# Daemon logs
tail -f .claude-flow/daemon.log

# Session logs
ls .claude-flow/sessions/
```

## 📚 Дополнительные ресурсы

- GitHub: https://github.com/ruvnet/claude-flow
- Skills: `.claude/skills/`
- Agents: `.claude/agents/`
- Config: `.claude-flow/config.yaml`
- Settings: `.claude/settings.json`

---

**Важно:** Claude Flow работает автоматически через hooks. Тебе не нужно вручную вызывать агентов - система сама определит最佳的 подход на основе прошлого опыта!

🚀 **Готов к работе!** Просто давай задачи, и Claude Flow будет автоматически оптимизировать процесс.
