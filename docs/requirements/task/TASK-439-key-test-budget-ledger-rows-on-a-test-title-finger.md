---
id: TASK-439
type: task
role: plan
title: "Key test-budget ledger rows on a test-title fingerprint, not (path,line): three unrelated insertions broke it in 24h"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: KN-260, type: relates-to}
---
Builds the fix that `knowledge-file-level-anchor-mutex-does-not-prevent-one-agent-s` (approved
2026-08-01) diagnosed but deliberately did not implement.

## Why now: three occurrences in ~24 hours, none of them a mistake

`scripts/test-budget-ledger.json` keys its 58 exempted rows on `(path, line, spawnCount)`. A pure
INSERTION anywhere above a row — by anyone, in a file the ledger's owner never touches — invalidates
it. Every occurrence so far surfaced as the same double failure: the old coordinate becomes an
orphaned row ("an exempt ledger entry must keep matching a REAL violation") while the unchanged
violation reappears at its new coordinate as "new debt".

| # | Trigger | Shift | Repair |
|---|---|---|---|
| 1 | `delta` batch inserted a control test near the top of `archive-sweep-cli.bun.test.ts` | 92 → 133 | re-anchor |
| 2 | the ac_scope gate's fixture sweep | 4 rows | re-anchor (`e4cc579`) |
| 3 | `a1f31e5` added 409 lines to `gate-hooks.bun.test.ts` (concurrent session, g1-gate work) | 346 → 351, 534 → 539 | re-anchor (`4406b7f`) |

In occurrence 3 the two sessions had ZERO git conflict and ZERO `file_anchors` intersection — the
ledger's owner cites lines inside a file it does not own, which is exactly the hole the knowledge doc
named. The repair is mechanical every time, which is precisely what makes it a design fault rather
than bad luck: a human/agent cost that recurs on a schedule set by unrelated work.

## Decision already recorded, to be implemented here

Key each row on a **test-title fingerprint** instead of a line number. The oracle already extracts
each violating case's `it()`/`test()` title (it prints them in the failure message), so the identity
it needs is already computed — only the ledger's key is wrong.

## Required

- Ledger rows key on `(path, titleFingerprint, spawnCount)`. `line` may REMAIN as a non-authoritative
  diagnostic hint, but MUST NOT participate in matching.
- Migrate all 58 existing rows in the same commit, deriving each fingerprint by running the oracle
  against the tree — ⛔ never by hand-transcribing titles, which reintroduces the
  contiguous-substring failure this repo has now measured repeatedly.
- Preserve the two behaviours the ADR
  (`adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`) makes load-bearing: new debt is
  never exempt, and an orphaned row still fails LOUD rather than being silently dropped. An orphaned
  row now means "this test case no longer exists or no longer violates", which is the assertion the
  ADR actually wanted — the current one only ever meant "someone inserted a line".
- ⛔ Do NOT make matching path-only as a shortcut: the knowledge doc explicitly credits the oracle for
  refusing to re-exempt by path alone, and that refusal must survive.

## Blast radius beyond this ledger

The knowledge doc generalises the fault to any artifact keyed by source coordinates: snapshot files,
line-numbered suppression lists, coverage exclusions, `:line` references in docs and specs. This task
fixes ONE instance. Whether the class needs a gate (an agent declaring `file_anchors` for files its
DATA cites, not only files it edits) is a separate decision and deliberately out of scope here.

## Oracle

A test that constructs a tree, records a ledger row, then INSERTS lines above the violating case and
asserts the row still matches (today this is the exact scenario that fails). Its control: renaming or
deleting the case makes the row orphan and fail loud. Plus
`bun run scripts/check-test-budgets.ts` → exit 0 against the real tree with all 58 rows migrated.
