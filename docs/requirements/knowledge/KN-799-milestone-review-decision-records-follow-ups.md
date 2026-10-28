---
id: KN-799
type: knowledge
role: knowledge
title: "Milestone review: Decision records follow-ups"
status: approved
priority: medium
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-245
links:
  - {id: PLAN-245, type: informs}
---
# Milestone review: FAIL

Fingerprint: 42b086efcfdc09c043518521292015e09bac802dd29852f3bee3097a41191d22
Diff: derived from 5 commit(s), excluding 0 merged in from main across the plan's tasks

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | pass | Both criteria have trusted-runner evidence: a recorded expected-fail run, then a pass. AC-DR-7: new cases cover every named bypass (rg --pre/--pre-glob/-z/--search-zip, git grep -O/--open-files-in-pager, git -c/-C/--git-dir/--exec-path, git diff --output/--no-index, --ext-diff, --textconv, unlisted lore and grep flags). They assert not-rerunnable and that the runner is never called. A positive case shows allowlisted commands still run. AC-DR-10: new cases show a deprecated holder and an invalidated holder each free their kind. The full test file and typecheck pass for both tasks. No milestone decisions are waiting. | decision-recheck.bun.test.ts 'AC-DR-7 each flag that runs a program or writes a file is not-rerunnable'; weight-table.bun.test.ts 'a retired table no longer holds its kind' |
| spec_conformance | pass | F2 replaces FORBIDDEN_FLAG with a FlagSpec allowlist for each command. It rejects any git option before the subcommand and keeps the SHELL_META rejection, as the task asked. F1 adds isLive (not deleted, archived, deprecated or isInvalidated) to findOtherHolder and updates the module invariant to match. Nothing outside the two tasks changed. | decision-recheck.ts isRerunnableCommand/argsWithinSpec; weight-table-service.ts isLive/findOtherHolder |
| regression | pass | Behaviour at risk: (1) cmd premises that used to re-run now report not-rerunnable if they use an unlisted flag (for example git show -p, rg --json, grep -A). This narrowing is intended, and the 'still re-run' case plus the existing 'git log -1' case cover the common forms (clustered short flags and -<k> counts were added for them). (2) The one-holder-per-kind refusal still applies to live tables; the earlier exit-4 cases in weight-table.bun.test.ts cover it, and the retire tests run last on purpose. The full-suite run on main failed (check:plan-close exit 1, test exit 5), but it attributes no failing file to this plan. | Full-suite run on main d9524e16: failing files attributed to this plan: none |
| design_necessity | pass | Each technical choice has an external reference. (1) A closed allowlist for each command instead of a deny-list follows OWASP input-validation allowlisting and the CWE-88 argument-injection guidance; GTFOBins documents the bypasses (rg --pre, git -c core.pager, git grep -O). (2) Refusing any git global option before the subcommand follows the same CWE-88 guidance on option injection before the verb. (3) Parsing valued flags the way getopt_long does (a value can be given with = or as the next word) mirrors how the tools themselves read their arguments. (4) Treating a table as live only when it is not deleted, archived, deprecated or invalidated follows temporal validity, a slowly changing dimension (type 2) where only the current row holds the key, as with a Postgres partial unique index over live rows. | OWASP Input Validation Cheat Sheet (allowlisting); CWE-88; GTFOBins rg/git; POSIX getopt_long; Kimball SCD type 2 / Postgres partial unique index |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-1476 (unknown: no-commit-recorded), BR-1477 (unknown: no-commit-recorded), BR-1478 (unknown: no-commit-recorded), BR-1479 (unknown: no-commit-recorded), BR-1480 (unknown: no-commit-recorded), BR-1481 (unknown: no-commit-recorded), BR-1482 (unknown: no-commit-recorded), BR-1483 (unknown: no-commit-recorded) (Every cited rule (BR-1476..BR-1483) is unknown (no-commit-recorded). None is contradicted.) | Cited rule state section |
| concurrency_safety | pass | isRerunnableCommand is a pure function of its input string. The isLive change only narrows the filter inside findOtherHolder. The check-then-write window between two concurrent 'lore weights set' calls for the same kind existed before this plan and is unchanged; the plan adds no new shared state or write path. | weight-table-service.ts findOtherHolder (read-only filter change) |
| security | fail | The allowlist is not fully closed. GIT_FLAGS is a plain object literal looked up by the attacker-chosen subcommand (GIT_FLAGS[first]), so inherited keys get through: 'git constructor x', 'git __proto__ x', 'git toString x' and similar return a truthy spec. With no flags, argsWithinSpec returns true and the runner executes 'git constructor ...'. Git then dispatches to an alias or a git-<name> executable on PATH, which breaks the 'anything else is not-rerunnable' promise of #482. With any flag (for example 'git constructor -x'), spec.valued is undefined, so .has throws a TypeError inside isRerunnableCommand and the milestone re-check crashes instead of returning not-rerunnable. The fix is a Map or an Object.hasOwn check. Apart from this the closed flag lists and the SHELL_META rejection are sound, assuming the runner execs argv without a shell, as the module header says. | decision-recheck.ts isRerunnableCommand: `const spec = first === undefined ? undefined : GIT_FLAGS[first]` |
