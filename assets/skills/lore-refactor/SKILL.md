---
name: lore-refactor
description: "Use when reorganizing existing code, extracting modules, renaming, migrating libraries/frameworks, or paying down tech debt. No new features, only structural improvement."
---

# Refactor - Mode: $0

Read `references/mode-$0.md` before starting. No mode → ask user.

| Mode | Reference | Focus |
|------|-----------|-------|
| `code` | `references/mode-code.md` | Function/class restructuring |
| `architecture` | `references/mode-architecture.md` | Architectural evolution |
| `migration` | `references/mode-migration.md` | Technology/framework migration |
| `debt` | `references/mode-debt.md` | Tech debt identification and cleanup |

## Step 0: Context & Entry Gate

Load existing ADRs/tech-specs from the lore corpus (`lore search "<topic>" --type adr --json`, `lore search "<topic>" --type spec --json`) — refactor must not violate existing decisions.
**MUST pass Entry Gate** (see `references/quality-gates.md` Gate 0) before touching code.

## Step 0.5: Refactor-vs-Rewrite Decision

Before planning, evaluate whether refactoring is the right approach.
See `references/quality-gates.md` — Refactor-vs-Rewrite Decision Framework.
If rewrite is indicated for >500 LOC → escalate to design skill.

## Principles

- **Automation first**: Prefer codemods, Serena rename_symbol, IDE refactoring over manual edits
- **Behavior preservation**: Same observable behavior unless explicitly changing it
- **Small steps**: Each step should compile and pass tests independently
- **Migration mode**: Query official docs (context7/deepwiki) for migration guides and breaking changes
- **Hard gates**: Every quality gate in `references/quality-gates.md` is MUST-PASS — no exceptions
- **No island operations**: Use handoff protocols in `references/skill-handoff.md` when crossing skill boundaries

## Sequential Thinking — Default reasoning engine

Refactoring involves architecture tradeoffs and migration path selection. **Default to `mcp__sequential-thinking__sequentialthinking`**:
- `architecture`: Current state analysis → target architecture reasoning → migration path evaluation → risk identification
- `migration`: Migration strategy comparison → breaking changes impact analysis → step ordering
- `debt`: Debt priority evaluation → ROI reasoning → cleanup order decision

**Principle**: ST first to reason about migration strategy and risks, then write code.

## Core References

| Reference | Purpose |
|-----------|---------|
| `references/smell-detection.md` | **Smell catalog + detection pipeline + smell→refactoring mapping** |
| `references/quality-gates.md` | **Hard quality gates, exit criteria, abort triggers, refactor-vs-rewrite** |
| `references/skill-handoff.md` | **Input/output contracts with review, diagnose, test, implement, design** |
| `references/refactoring-catalog.md` | Fowler refactoring decision index |
| `references/migration-patterns.md` | Migration strategy selection |
| `references/debt-management.md` | RICE, Debt Quadrant, prioritization |

## Workflow

1. **Gate 0 — Entry**: Baseline green, metrics captured, scope bounded, rollback plan ready
2. **Assess**: Smell detection pipeline (`references/smell-detection.md`), hotspot analysis, Serena symbols
3. **Plan**: Target state, migration path, safety checks, smell→refactoring mapping
4. **Prepare**: Add tests if missing, create checkpoint
5. **Execute**: Apply changes in small increments, Gate 1 after each step (tests + compile + lint)
6. **Gate 3 — Exit**: All tests pass, no metric regression, behavior preserved
7. **Gate 4 — Evidence**: Before/after metrics table, file list, test evidence
8. **Handoff**: Trigger review (if architecture mode or high-risk structural changes), test (if coverage gaps), or next skill

## Skill Handoff Quick Reference

```yaml
receive_from: [review, diagnose, implement]  # See references/skill-handoff.md
hand_off_to:
  review: "After architecture refactoring or high-risk structural changes"
  test: "When coverage drops or new interfaces created"
  diagnose: "When refactoring reveals a bug — STOP, checkpoint, hand off"
  design: "When architectural decision needed — STOP, checkpoint, hand off"
  implement: "When refactoring unblocks feature implementation"
```
