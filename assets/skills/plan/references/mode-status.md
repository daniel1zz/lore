# Plan Mode: status

**Purpose**: View plan status, progress, critical path health, risk summary, and estimation accuracy

## Workflow

1. `lore tree <plan>` → task tree grouped by phase, claim/evidence badges
2. `lore list --type task --plan-id <plan> --json` → per-task status/priority for stats
3. `lore get <plan>` → Invariants, Risk Register, Estimation Summary, Critical Path, Decisions Log
4. `lore ready <plan> --json` → ready/blocked records + sessions[] + anchor_conflicts[]
5. Optional corpus-level context: `lore status` (health snapshot), `lore pending` (docs awaiting review)

## Output

```markdown
**Plan: [title]** (slug: plan-xxx, status: {approved|draft|...})
Progress: {completion_pct}% ({archived}/{total})
Phases: ✅ ✅ 🔄 ○ ○

| Phase | Status | Tasks | Archived | Est | Actual |
|-------|--------|-------|----------|-----|--------|
| Phase 1: [name] | ✅ | 4 | 4/4 | 5 su | 4 su |
| Phase 2: [name] | 🔄 | 5 | 3/5 | 6 su | 4 su* |
| Phase 3: [name] | ○ | 3 | 0/3 | 4 su | — |

**Schedule Health**: {ahead/behind/on-track}
- Estimated total: {N} session-units | Actual so far: {M} session-units
- Estimation accuracy: {pct}% (Reference Class factor: {x})

**Critical Path**: {remaining tasks} → total remaining: {N} session-units
→ task-xxx (M, claimed) → task-yyy (S, ready) → task-zzz (M, blocked)

**Risk Register** ({total} risks):
| # | Category | Impact | Status | Trigger |
|---|----------|--------|--------|---------|
| 1 | Technical | H | mitigated | [trigger] |
| 2 | Scope | M | active | [trigger] |
| 3 | Dependency | L | closed | [trigger] |

**Ready Tasks**: [from lore ready --json, ⭐ = priority critical/high]
**Blocked Tasks**: [with unmet_blockers from the ready report]
**Live Sessions**: [sessions[] — actor@machine:worktree + held tasks]
**Anchor Conflicts**: [none | list]
**Deprecated Tasks**: [list with rationale]
**Invariants**: [count] active
**Latest Handoff**: [lore feed session-resume --plan <plan> summary, if any]
```
