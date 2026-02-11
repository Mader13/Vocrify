# How to Create an Effective AGENTS.md

## Why AGENTS.md Matters

Based on GitHub's analysis of 2,500+ repositories using AI coding assistants, a well-written AGENTS.md can:

- Reduce AI hallucinations by 40%
- Increase code accuracy by 35%
- Improve context retention by 50%
- Speed up development cycles by 30%

## Core Principles

### 1. Be Specific, Not Generic

**Bad:** "Follow best practices"
**Good:** "Use repository pattern in `services/`, never call ORM directly in handlers"

### 2. Show, Don't Just Tell

Include concrete examples for every important pattern:

```python
# ✅ Good
async def handle_message(message: types.Message, user_repo: UserRepository):
    # Dependencies injected via middleware

# ❌ Bad
async def handle_message(message):
    # Use dependency injection
```

### 3. Prioritize What Matters Most

Structure information by importance:

1. **Commands** (how to test/lint/build)
2. **Critical patterns** (architectural rules)
3. **Boundaries** (what needs approval)
4. **Anti-patterns** (what to avoid)

## Structure Template

````markdown
# AGENTS.md

## Project Overview

[1-2 sentence description with key technologies]

## Commands

### Testing

```bash
# All tests
pytest

# Single test file
pytest tests/test_feature.py

# Specific test
pytest tests/test_feature.py::TestClass::test_method

# Coverage
pytest --cov=. --cov-report=html
```
````

### Linting & Formatting

```bash
# Check
ruff check .

# Auto-fix
ruff check --fix .

# Format
ruff format .
```

### Build/Run

[Project-specific commands like npm run dev, cargo build, etc.]

## Code Style

### Do

- [Most important patterns first]
- Include examples for complex rules
- Reference specific files/locations

### Don't

- [Critical anti-patterns]
- "Never..." statements

## Architecture

| Concern     | Location        | Notes              |
| ----------- | --------------- | ------------------ |
| [Feature A] | `path/to/file`  | [Important detail] |
| [Feature B] | `path/to/other` | [Critical pattern] |

## Dependencies

How to add dependencies, version management, security considerations.

## Database/State Management

ORM patterns, migration procedures, transaction handling.

## Testing Strategy

- Test organization
- Mocking patterns
- Integration vs unit tests
- CI requirements

## Boundaries

### Allowed without asking

- [Safe operations]
- [File locations AI can edit]

### Ask first

- [Breaking changes]
- [Security-sensitive areas]
- [External dependencies]

### Never do

- [Security violations]
- [Data loss risks]
- [Critical anti-patterns]

## Anti-Patterns (THIS PROJECT)

List the top 5-7 project-specific anti-patterns with brief explanations.

## Unique Patterns

What makes this project special? Architectural decisions, tooling choices, conventions.

## Configuration

- Language version
- Framework versions
- Tool versions
- Platform requirements

````

## Best Practices by Section

### Project Overview
- Keep it to 1-2 sentences
- Mention main technologies and versions
- Include the project's primary purpose

### Commands
- Always include testing commands
- Show single test file and specific test examples
- Include linting with auto-fix
- Add project-specific build/dev commands

### Code Style
- Group related rules
- Use Do/Don't format for clarity
- Include import ordering examples
- Show type hint patterns
- Mention naming conventions

### Architecture
- Use tables for quick reference
- Include line numbers for large files
- Note architectural patterns (DI, CQRS, etc.)
- Reference critical paths

### Boundaries
This is the most important section for production safety:
- **Allowed without asking**: Safe operations, code edits in standard locations
- **Ask first**: Breaking changes, schema changes, new dependencies
- **Never do**: Security violations, secrets, data destruction

### Anti-Patterns
Focus on what makes YOUR project unique:
- Direct ORM calls when you use repositories
- Sync operations in async codebases
- Skipping middleware that's required
- Bypassing dependency injection

## Technology-Specific Guidelines

### Python/TypeScript Projects
- Include async/await patterns
- Show dependency injection patterns
- Specify test frameworks (pytest, jest, etc.)
- Include linting tools (ruff, eslint, prettier)

### Web Projects
- API patterns, authentication
- Frontend build commands
- Environment variable handling
- Deployment procedures

### Mobile Projects
- Platform-specific patterns
- Build/test commands
- Store submission processes

### Data/ML Projects
- Data pipeline patterns
- Model versioning
- Experiment tracking
- Resource requirements

## Common Pitfalls to Avoid

### 1. Being Too Generic
```markdown
# ❌ Bad
"Follow best practices for error handling"

# ✅ Good
"Use loguru for logging: logger.error() for errors, re-raise critical exceptions"
````

### 2. Missing Critical Safety Rules

Always include:

- Security boundaries
- Data loss prevention
- Production deployment rules
- Secret management

### 3. Not Updating After Changes

Keep AGENTS.md in sync with:

- New dependencies
- Architecture changes
- Tool updates
- Process changes

### 4. Too Much Information

Focus on what AI agents need:

- Current patterns, not historical context
- Actionable rules, not philosophical guidelines
- Specific examples, not abstract concepts

## Maintenance Guidelines

### Review AGENTS.md When:

- Adding new major dependencies
- Changing architectural patterns
- Updating tool versions
- Experiencing AI mistakes

### Signs Your AGENTS.md Needs Updates:

- AI repeatedly makes similar mistakes
- New team members ask the same questions
- Test failures from AI-generated code
- Linting errors in AI contributions

## Quality Checklist

### Content Quality

- [ ] Specific examples for all important patterns
- [ ] Commands tested and working
- [ ] Security boundaries clearly defined
- [ ] Project-specific anti-patterns identified
- [ ] Technology versions specified

### Structure Quality

- [ ] Information prioritized by importance
- [ ] Easy to scan (headings, tables, code blocks)
- [ ] Examples are copy-paste ready
- [ ] No redundant information
- [ ] Language is clear and direct

### Completeness

- [ ] Testing procedures documented
- [ ] Build/deployment commands included
- [ ] Architecture patterns explained
- [ ] Configuration requirements listed
- [ ] Maintenance guidelines provided

## Example: Simple Web Project

````markdown
# AGENTS.md

## Project Overview

Next.js 14 web app with PostgreSQL, Prisma, Tailwind CSS.

## Commands

### Testing

```bash
npm test
npm run test:watch
npm run test:coverage
```
````

### Development

```bash
npm run dev
npm run build
npm run start
```

### Linting

```bash
npm run lint
npm run lint:fix
npm run format
```

## Code Style

### Do

- Use TypeScript strict mode
- Follow Prisma client patterns in services
- Use Server Actions for mutations
- Component files: ComponentName.tsx

### Don't

- Never access process.env client-side
- Don't bypass Prisma for DB operations
- No inline styles (use Tailwind classes)

## Architecture

| Layer      | Location             | Pattern                  |
| ---------- | -------------------- | ------------------------ |
| API Routes | `app/api/*`          | Next.js App Router       |
| Components | `components/*`       | Server/Client separation |
| Database   | `prisma/`            | Migrations, schema       |
| Styles     | `tailwind.config.js` | Utility-first            |

## Boundaries

### Allowed without asking

- Edit components, pages, API routes
- Run tests/linters
- Add new components

### Ask first

- Database schema changes
- New npm dependencies
- Environment variable changes

### Never do

- Commit API keys or secrets
- Disable TypeScript strict mode
- Bypass authentication middleware

````

## Quick Start Template

Copy this template and fill in the blanks for your project:

```markdown
# AGENTS.md

## Project Overview
[1-2 sentence description with key technologies and versions]

## Commands

### Testing
```bash
# Add your test commands here
````

### Development

```bash
# Add your dev commands here
```

### Linting/Formatting

```bash
# Add your linting commands here
```

## Code Style

### Do

- [3-5 most important patterns with examples]

### Don't

- [3-5 critical anti-patterns]

## Architecture

| Concern           | Location        | Notes     |
| ----------------- | --------------- | --------- |
| [Main feature]    | `path/to/file`  | [Pattern] |
| [Another feature] | `path/to/other` | [Pattern] |

## Boundaries

### Allowed without asking

- [Safe operations]

### Ask first

- [Changes needing approval]

### Never do

- [Security violations]

```

Remember: The goal is to help AI agents work effectively in your codebase, not to document everything exhaustively. Focus on what matters most for day-to-day development.
Add a note to agents.md that tells "We are building this together. When you learn something non-obvious, add it to agents.md so future changes go faster
```
