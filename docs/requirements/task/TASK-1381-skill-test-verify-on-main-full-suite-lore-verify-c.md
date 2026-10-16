---
id: TASK-1381
type: task
role: plan
title: "[Skill:test] Verify on main: full suite, lore verify, close resolved reports"
status: archived
priority: critical
phase: "Phase 2: verification"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-189
plan: PLAN-189
---
Estimate: M
Approach: orchestrator-run on main after the last fix merges: bun run build (before any dist/lore-spawning oracle); bun run typecheck; bun run test:vitest and bun run test:bun separately; lore verify plan-close-the-eight-verified-critical-defects; review the first post-fix mirror export diff in full (R2); CLI repro of task-gh-1343388703-27 before closing it; close every resolved report with its fix commit.
Source: plan Exit Criteria; .claude/rules/lore-worktree-dispatch.md
Dimensions: D-FUNC
Scope-Alt: none
Covers: AC-CRIT-1, AC-CRIT-2, AC-CRIT-3, AC-CRIT-4, AC-CRIT-5, AC-CRIT-6, AC-CRIT-7, AC-CRIT-8, AC-CRIT-9, AC-CRIT-10, AC-CRIT-11
AC:
- lore verify reports AC-CRIT-1..11 pass with attestation on main HEAD
- bun run test:vitest and bun run test:bun introduce NO failure that is absent at baseline 8395a3b6 (exit codes measured without a pipe)
- each of T1-T8 has an expected-fail evidence row recorded before its pass row (INV-3)
- lore issues --local --open lists none of the 10 fully resolved reports; task-gh-1343388703-34 stays open with a comment naming the F1 commit and the remaining verdict-policy half
Integration: n/a (verification only)


## Correction (2026-10-16, user-approved)
Original AC line: "bun run test:vitest and bun run test:bun each exit 0 on main". Measured at HEAD d84fcc6d: test:vitest exit 1 (19 failed / 11486 passed, 15 after the mirror re-export and anchor declaration), test:bun exit 1 (5 failed / 3140). A read-only triage re-ran every failing file at baseline 8395a3b6: every failure reproduces there with the identical assertion; none is caused by the eight merges (class A = 0). Causes are filed: #227 (fragment-prose pins, incl. AC-083-1/AC-CP-7), #233 (setup manifest sha before language projection; surfaces as 2 env-dependent setup failures), #234 (export-index human_id duplicates), #235 (test budgets, store CLAUDE.md eviction floor, plan-close-cascade deep-equal, mirror-status-parity baseline mappings, ac-ref ambiguity, anchor-coverage ledger). The line is corrected to "no failure absent at baseline", which is what this plan can own; making main green is a separate plan. This narrows scope, it does not hide a regression introduced here.
