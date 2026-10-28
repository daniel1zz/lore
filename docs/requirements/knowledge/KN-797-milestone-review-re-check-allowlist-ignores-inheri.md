---
id: KN-797
type: knowledge
role: knowledge
title: "Milestone review: Re-check allowlist ignores inherited object keys"
status: approved
priority: medium
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-242
links:
  - {id: PLAN-242, type: informs}
---
# Milestone review: PASS

Fingerprint: f2910585ed347cde48aa7a53b6598f43c17b522376abf028daacc2a9f3f04c8f
Diff: derived from 2 commit(s), excluding 0 merged in from main across the plan's tasks

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | pass | AC-DR-7 is attested by a trusted runner in two states: expected-fail before the fix, then pass after it. The full decision-recheck test file and typecheck also pass. The new case covers each inherited key the plan names (constructor, __proto__, toString, hasOwnProperty, valueOf) as a git subcommand with a positional or a flag, as a top-level program, and as a lore verb. It checks that isRerunnableCommand does not throw and returns false, that every finding is not-rerunnable, and that the runner is never called. No milestone decisions are pending. | attested evidence for task-g1 (ac AC-DR-7); decision-recheck.bun.test.ts:248-266 |
| spec_conformance | pass | The spec says any command off the read-only allowlist is not-rerunnable and is not run. The diff changes GIT_FLAGS from an object literal to a ReadonlyMap and looks it up with .get(first), so an unknown or inherited subcommand gives undefined and returns false. The other name tables already avoid inherited keys: LORE_READ_VERBS is a Set, and the program dispatch compares strings with ===. The test proves that `lore constructor x` and `constructor x` are rejected. The change does nothing beyond the plan's scope. | spec Scope 'Milestone re-check' command sources; decision-recheck.ts:118-169 |
| regression | pass | Behaviour at risk: the existing allowlist for git show, log, diff and grep with their flag specs. The existing AC-DR-7 tests cover it (the allowed-command run list at :245), and the whole decision-recheck test file passes. The batch run on main 788d2a29 failed (check:plan-close exit 1, test exit 5), but it attributes no failing file to this plan. | full-suite section (none attributed); decision-recheck.bun.test.ts AC-DR-7 command premises |
| design_necessity | pass | There is one technical choice: use a Map, an own-key lookup, instead of indexing a plain object with untrusted input. This is the standard defence against prototype-chain key confusion, because a Map has no inherited entries. The test choice of enumerating Object.prototype member names follows the same guidance. | OWASP Prototype Pollution Prevention Cheat Sheet (use Map/Set or Object.hasOwn instead of object-literal lookups); MDN 'Map vs Object' (accidental keys) |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-1476 (unknown: no-commit-recorded), BR-1477 (unknown: no-commit-recorded), BR-1478 (unknown: no-commit-recorded), BR-1479 (unknown: no-commit-recorded), BR-1480 (unknown: no-commit-recorded), BR-1481 (unknown: no-commit-recorded), BR-1482 (unknown: no-commit-recorded), BR-1483 (unknown: no-commit-recorded) (Every cited rule (BR-1476 through BR-1483) is unknown (no-commit-recorded), and none is contradicted. The comment added beside GIT_FLAGS correctly describes the new code.) | cited rule state section |
| concurrency_safety | pass | isRerunnableCommand is a pure function over a module-level map that is never mutated, and the change adds no shared writable state, so concurrent re-checks cannot interfere. | decision-recheck.ts:119 (ReadonlyMap constant) |
| security | pass | The change closes the hole the earlier review found. `git constructor x` could reach git alias or git-<name> dispatch, and `git constructor -x` crashed the re-check. Both are now refused before the runner is called, and the test asserts the runner is never invoked. The change adds no new input path, credentials or privilege. | OWASP Prototype Pollution Prevention Cheat Sheet; knowledge-milestone-review-decision-records-follow-ups-2 security finding |
