---
name: lore-domain
description: "Use when the user says 'analyze domain', 'domain model', 'glossary', 'business workflow', '领域分析', '领域模型', '业务流程', or needs to understand, create or update domain knowledge before implementation. NOT for permanent business rule ids and the citation gate (use lore-baseline), nor for role or scenario business reviews (use lore-biz-review). Args: '<mode> [context]' — the FIRST token is the mode, one of: activate|analyze|create|quick-lens|quick-scenario|update."
---

# Domain - Mode: $0

Read `references/mode-$0.md` before starting. No mode → ask user.

| Mode | Reference | Focus |
|------|-----------|-------|
| `analyze` | `references/mode-analyze.md` | Discover and analyze domain entities, rules, workflows using DDD |
| `create` | `references/mode-create.md` | Create domain documentation (files + lore knowledge registration) |
| `quick-lens` | `references/mode-quick-lens.md` | Rapidly create Expert Lenses without full domain docs |
| `quick-scenario` | `references/mode-quick-scenario.md` | Rapidly create Business Scenarios without full domain docs |
| `activate` | `references/mode-activate.md` | Load domain context for other skills |
| `update` | `references/mode-update.md` | Update existing domain knowledge |

## DDD Methodology References (load on demand)

| Reference | When to Load |
|-----------|--------------|
| `references/event-storming.md` | During analyze mode for non-trivial domains |
| `references/aggregate-design.md` | When identifying aggregate boundaries |
| `references/context-mapping.md` | When mapping bounded context relationships |

## Philosophy
"Knowledge once, use everywhere" — docs/domain/{domain}/ is the SSOT (registered in lore as `knowledge --sub-type reference` docs when the project has `.lore/`).
Skills are pointers, documents are content. One knowledge source, reused across implement/test/review/diagnose.

DDD methodology pipeline: Structure Scan → Event Storming → Aggregate Design → Context Mapping → Strategic Classification → Ubiquitous Language.

## Architecture
- **Document layer**: `docs/domain/{domain}/` — entities, aggregates, rules, workflows, glossary, event-storm (registered in lore via `lore create knowledge --parent <spec or prd it concerns> --sub-type reference`)
- **Skill layer**: `.claude/skills/{domain}-domain/` — knowledge loader that activates domain context
- **Cross-domain**: When working on feature X, activate all relevant domains first
