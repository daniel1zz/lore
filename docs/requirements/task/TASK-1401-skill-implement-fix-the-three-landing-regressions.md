---
id: TASK-1401
type: task
role: plan
title: "[Skill:implement] fix the three landing regressions the full suite traced to the session trail: a test timeout declaration, the co_change project-specific key, the setup settings golden"
status: archived
priority: high
phase: "landing"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-188
plan: PLAN-188
links:
  - {id: TASK-1373, type: blocks}
---
Estimate: S
Approach: three regressions the full suite on main (after the session-trail merges) traced to this plan; fix each at its root, weaken nothing.
1. scripts/check-test-budgets.ts (bun run check:test-budgets, exit 5) flags packages/lore/tests/integration/hooks/stop-turn-review-trail-source-edits.test.ts:105 ('AC-ST-4 merging a 200-line branch ...', 3 spawn-helper calls, no explicit timeout). Declare an explicit timeout as the it() third argument for that case, and for any other case in the session-trail test files the checker flags.
2. scripts/check-shipped-defaults.ts (exit 3): 'DRIFT workflow.turn_end.co_change: this repo overrides it ... but the shipped surface carries []'. Per the spec's S1 decision (co-change rules are project config, no shipped defaults) add workflow.turn_end.co_change to PROJECT_SPECIFIC_KEYS with a rationale citing that decision; do NOT change the code default or the template.
3. packages/lore/tests/unit/setup/claude-dir-variable.test.ts AC-CV-7 (a): the fresh-setup settings.json golden predates the new trail hook registrations (session-trail-start.mjs on SessionStart/SubagentStart, subagent-trail.mjs on SubagentStop). Re-baseline the golden to the shipped roster only for those entries; every other byte unchanged.
Oracles: bun run check:test-budgets and bun run check:shipped-defaults — the session-trail entries must be gone (other pre-existing findings in those checks belong to other work and stay), the AC-CV-7 test, scripts/tests/check-test-budgets.test.ts and check-shipped-defaults.test.ts (they must stop failing on the session-trail findings; if they still fail only on findings this plan did not cause, report them), bun run typecheck.
Source: spec spec-session-trail-a-session-local-record-of-what-each-run-4 (Scope decisions; S1 'no shipped defaults'); plan Exit Criteria (full suite green on main).
AC: none of its own (the AC-ST oracles stay green; re-run AC-ST-4 and AC-ST-12).
Governing spec: spec-session-trail-a-session-local-record-of-what-each-run-4. Plan invariants I1-I7 apply.
