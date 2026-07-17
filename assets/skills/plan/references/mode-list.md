# Plan Mode: list

**Purpose**: List all plans and their status

## Mandatory

- **Session start**: the hook-injected bootstrap (`lore bootstrap --json`) already carries active_plans — consume it, don't re-derive
- If an active (unfinished) plan exists → MUST prompt user to resume or skip

## Workflow

1. `lore list --type plan --json` → all plan docs (slug, status, updated_at)
2. For each plan: `lore ready <plan> --json` → task counts (ready / blocked / archived) — or `lore tree <plan>` for a quick visual
3. Display summary table
4. Highlight plans with unarchived tasks (in progress)
5. Suggest resume if applicable

## Output

```markdown
| Slug | Title | Status | Priority | Progress |
|------|-------|--------|----------|----------|
| plan-auth-system | Auth System | approved | high | 42% (5/12 archived) |
| plan-api-migration | API Migration | archived | medium | 100% (8/8) |

Active: 1 | Completed: 1 | Total: 2
→ Suggest: resume plan-auth-system (mode: resume)
```
