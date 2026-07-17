# Domain - Mode: activate

**Purpose**: Deep-load domain knowledge for current task (manual mode — daily reads handled by Doc Routing)

## Workflow

1. `lore search "<domain>" --type knowledge` → check recent domain changes
2. Identify relevant domains from user request (max 2)
3. Load `.claude/skills/{domain}-domain/SKILL.md` (scope, constraints, cross-domain rules)
4. Smart doc loading:

| Always | `docs/domain/{domain}/README.md`, `expert-lenses.md` |
|--------|------------------------------------------------------|
| **Task** | **Auto-load** |
| implement | rules.md, workflows.md, aggregates.md |
| diagnose | rules.md, codebase.md, aggregates.md |
| review | rules.md, entities.md, glossary.md |
| refactor | codebase.md, entities.md, aggregates.md |
| test | rules.md, workflows.md, aggregates.md |
| design | aggregates.md, glossary.md, entities.md |

5. Announce: active domain, scope, strategic type (core/supporting/generic), key constraints, **loaded Expert Lenses** (names + checklist count), docs loaded
