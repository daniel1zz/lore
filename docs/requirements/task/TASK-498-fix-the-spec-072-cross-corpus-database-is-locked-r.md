---
id: TASK-498
type: task
role: plan
title: "Fix the SPEC-072 cross-corpus database-is-locked race exposed by the libsql lazy-load speedup"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## Symptom

`packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts` → `AC-072-9 / AC-IC-5` ("2 concurrent CLI invocations → both write, or exactly one writes while the other refuses with the declared code and template") fails on main.

Measured by the orchestrator on merge commit `f3811f8`, **3 out of 3 consecutive runs failed** (the implementing agent had reported ~4/5; it is worse than that):

```
error: exit codes 1/0 match neither declared state (both 0, or exactly one 0 and the other 5 with the declared template)
first stderr: Error: Storage failure: failed reading PRAGMA user_version from
  '<tmp>/lore-upstream-ac9-XXXX/.lore/lore.db': database is locked
second stderr: (empty)
```

The rest of the file passes (10 pass / 1 fail).

## Root cause (diagnosed, not guessed)

A pre-existing SQLite lock race in the SPEC-072 cross-corpus write path: the upstream-corpus schema precheck reads `PRAGMA user_version` without tolerating a concurrent writer's lock, so one of two concurrent `lore report-issue` invocations dies with `database is locked` instead of landing on either declared outcome.

It was **exposed, not caused**, by `spec-eager-libsql-load-makes-every-command-depend-on-a-healthy`: deferring the eager libsql native load cut CLI cold start ~5x (0.4s → 0.08s), removing the scheduling jitter that had been accidentally serialising the two invocations. The implementing agent confirmed the direction by A/B — stash + rebuild the pre-fix binary → the same repro passes; rebuild with the fix → it fails.

This is the "workaround compounds" pattern in reverse: the race was always there, and an unrelated performance accident was the only thing hiding it.

## Constraints for the fix

- ⛔ Do NOT reintroduce delay, retry, or an eager load to restore the jitter — that would re-hide the defect and re-break the TMPDIR fix. Fix the lock handling.
- The declared concurrency contract is the spec's, not this task's to redefine: both write, OR exactly one writes while the other refuses with the declared code and the declared message template. `database is locked` is neither.
- Governing spec for the contract: SPEC-072 / the upstream-issue-reporting spec family (`lore search "report-issue concurrency contract"` — note an approved plan `plan-implementation-report-issue-concurrency-contract` already exists and may be the correct home for this work rather than a standalone task).

## Oracle

`cd packages/lore && bun test tests/unit/service/issue-report-cross-corpus.bun.test.ts -t "AC-072-9"` must pass on **5 consecutive runs** (a single green run proves nothing for a race that already varies 3/5–5/5 between reporters). Report the run count explicitly.
