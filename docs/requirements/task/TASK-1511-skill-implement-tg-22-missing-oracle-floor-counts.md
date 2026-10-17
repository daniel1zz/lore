---
id: TASK-1511
type: task
role: plan
title: "[Skill:implement] TG-22 missing-oracle floor counts only passes that ran the missing file"
status: archived
priority: critical
phase: "Phase 3: guards"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1496, type: blocks}
---
Estimate: S
Approach: Measured on main c82d313d: `lore done task-skill-test-tg-2-move-five-live-repo-state-tests-into-check` exits with "covers AC(s) whose oracle file is missing: AC-TG-9 (scripts/tests/test-cleanup-exit.test.ts)". AC-TG-9 is declared red-first (--allow-missing-path). T2 carries a pass row with ac_ref AC-TG-9 whose command runs T2's own five test files, not the AC's oracle file; the floor (task-workflow-service.ts, commit 541a955a) treats any pass tagged with the AC as "a pass on record" and refuses. The lie the floor guards against is an earlier pass OF THE MISSING FILE. Narrow "pass on record" to a pass whose command names the missing oracle path (same path matching verify uses); keep refusing when such a pass exists. Same rule wherever the not_measured derivation decides "had a pass".
Source: spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-6
AC: verify-missing-oracle-file.test.ts gains a case: declared red-first AC + a pass tagged with that AC whose command runs a different existing file -> done allowed; existing cases stay green.
