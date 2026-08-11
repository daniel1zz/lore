---
id: KN-306
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| Judgment | Confidence |
|---|---|
| All requested work done + 3 follow-ups from assess. Full suite GREEN at 7a7445e on a clean isolated tree: vitest 388 files/6644 tests, bun 1531 pass/0 fail. | 95 |
| Cross-check that matters: the regression run measured 1530 pass/1 fail, the fix run 1531/0 — the delta is exactly the one repaired test, so nothing was silently skipped into green. | 95 |
| MY OPERATIONAL ERROR: a concurrent session cut branch fix/governance-never-discard-lore-output off 60de416 mid-session; the shared checkout followed, and my next two git merges landed on THEIR branch. Work is intact, just not on main. | 95 |
| Full suite caught a real regression that the repo's scoped oracle (bun run test:changed) reported clean — concrete proof that scoped selection under-covers integration tests, and that full-suite-by-main-agent is not ceremony. | 90 |

## Failing Oracle

(none)

## Next Steps

- Branch ownership (user decided: LEAVE AS IS): 4 of my commits sit on fix/governance-never-discard-lore-output — 2edd170+500e92e (evidence placeholder guard) and ae6ec89+7a7445e (its ordering fix). main is at 60de416. They reach main when that branch merges. TELL THE OTHER SESSION its branch carries foreign work, so a rebase/abandon does not silently drop it.
- NOT MINE, do not touch without coordinating: main commit 5c197d8 changed assets/governance/corpus-workflow.md WITHOUT regenerating packages/lore/src/generated/assets-manifest.ts — committed sha256 + tree_digest are stale. This is what the session-start 'lore assets outdated (2 files)' warning has been reporting. Needs a rebuild + commit by whoever owns that change.
- NOT MINE: new drift — plan-implementation-context-provenance-scope-declaring has all 5 child tasks terminal but is still approved, so check-tree exits 3. Belongs to the concurrent session; closing it would cascade-archive its children. Its owner should run lore set <plan> --status archived.
- CLAUDE.md in the shared working tree still holds TWO sessions' uncommitted edits (my gate-retroactivity standing lesson + their 'Five false-oracle vectors'). Any commit carries both. Unresolved.
- Not reproducible, deliberately NOT fixed: the 8 stderr.toHaveLength(0) assertions in cli-create.bun.test.ts / cli-editor-integration.bun.test.ts. Three constructed orderings (reset-caller first, no LORE_ACTOR, shared process) all stayed green. Changing code without an oracle is the anti-pattern; left recorded instead.
- Still open from earlier: SPEC-073's AC-073-1/AC-073-3 text still describes byte-absence that SPEC-OOB overturned — no revision path exists (lore ac has no update; rm is blocked by evidence refs; editing the body demotes an implemented spec). relates-to link left as the trail.
