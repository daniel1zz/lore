---
id: KN-796
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
| correctness_vs_acs | pass | The plan claims AC-DR-7. The trusted runner recorded an expected-fail run of `-t 'AC-DR-7'` before the change and a pass after it. The pass is also recorded against the ac itself as `(ac AC-DR-7)`. The full decision-recheck test file and `bun run typecheck` also passed under the runner. The new test checks every case the task named, for all five inherited keys: `git <key> x`, `git <key> -x` (including `git constructor -x`), a top-level `<key> x` and `lore <key> x`. For each it asserts that `isRerunnableCommand` does not throw and returns false, that the re-check reports `not-rerunnable`, and that the runner is never called (`ran` equals []). No milestone decisions are waiting for review. | Attested evidence for task-g1-the-re-check-allowlist-uses-own-key-lookups; decision-recheck.bun.test.ts, the new 'AC-DR-7 an inherited object key…' case |
| spec_conformance | pass | The spec says any command outside the read-only allowlist is not-rerunnable and is never run. The goal asks for own-key lookups for every table. The diff turns GIT_FLAGS into a ReadonlyMap and replaces `GIT_FLAGS[first]` with `GIT_FLAGS.get(first)`. LORE_READ_VERBS is already a Set, and the top-level program checks are `===` comparisons, so the passing test cases for `<key> x` and `lore <key> x` show that no other table lets an inherited key through. The change does no more than this: the allowlist contents and the flag specs are unchanged. | Spec Scope 'Milestone re-check', command sources; plan Goal |
| regression | pass | The behaviour at risk is that allowlisted git subcommands (show, log, diff, grep) stay rerunnable with their flag specs. The Map holds the same four entries with the same specs. The existing AC-DR-7 case `expect(ran).toEqual(allowed)` and the full decision-recheck test file both passed. The batch suite run on main 788d2a29 failed (check:plan-close exit 1, test exit 5), but it attributes no failing file to this plan. | Full-suite section (no failing files attributed to this plan); decision-recheck.bun.test.ts |
| design_necessity | pass | There is one technical choice: use a Map keyed by subcommand, not an object literal, so a lookup only finds the table's own keys. This is the standard way to stop prototype-chain keys from resolving on lookup tables. The test choice, a fixed list of inherited Object.prototype names, follows the usual practice of negative testing for allowlist bypass. | OWASP Prototype Pollution Prevention Cheat Sheet (use Map/Set or Object.hasOwn instead of plain-object lookups); MDN 'Map vs Object' (no default keys from the prototype) |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-1476 (unknown: no-commit-recorded), BR-1477 (unknown: no-commit-recorded), BR-1478 (unknown: no-commit-recorded), BR-1479 (unknown: no-commit-recorded), BR-1480 (unknown: no-commit-recorded), BR-1481 (unknown: no-commit-recorded), BR-1482 (unknown: no-commit-recorded), BR-1483 (unknown: no-commit-recorded) (All cited rules, BR-1476 to BR-1483, are unknown (no-commit-recorded). None is contradicted, so this dimension cannot fail.) | Cited rule state section |
| concurrency_safety | na | The change replaces one module-level read-only constant with a ReadonlyMap that is never mutated, and the lookup inside a pure predicate. It adds no shared mutable state, no store write and no process. | decision-recheck.ts:118-119, 168 |
| security | pass | The change closes the hole reported by the security finding. Before it, `git constructor x` passed the allowlist and was re-run, and git could dispatch that to an alias or a `git-<name>` program. `git constructor -x` threw and crashed the re-check. Now inherited keys miss the Map, so these commands are not-rerunnable and never reach the runner, which the test verifies. The change adds no new input path, credential or privilege. | OWASP Prototype Pollution Prevention Cheat Sheet; CWE-1321 |
