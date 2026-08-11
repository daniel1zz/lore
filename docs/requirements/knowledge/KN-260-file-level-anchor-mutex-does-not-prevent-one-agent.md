---
id: KN-260
type: knowledge
role: knowledge
title: "File-level anchor mutex does not prevent one agent's DATA from referencing another agent's file: a (path,line) ledger broke on a pure insertion, surfacing as orphaned-row AND new-debt at once"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
MEASURED 2026-08-01, full-suite run after merging five concurrently-dispatched worktree agents.

## What happened

Two batches were dispatched concurrently with deliberately disjoint code anchors:
- eps: `scripts/check-test-budgets.ts` + a new `scripts/test-budget-ledger.json` recording the
  58 baseline violations as `(path, line, spawnCount)` rows.
- delta: `packages/lore/tests/integration/archive-sweep-cli.bun.test.ts` — inserted a live
  gate-disable control test NEAR THE TOP of the file.

Both were correct in isolation, both passed their own scoped oracles, both merged cleanly with
zero git conflict. The full suite then failed: `check-test-budgets` exited **5**, and the same
single violation appeared as BOTH failure classes at once —

    orphaned row : archive-sweep-cli.bun.test.ts:92   (nothing violates there any more)
    new debt     : archive-sweep-cli.bun.test.ts:133  ("NOT covered by the ledger")

delta`s insertion pushed the unchanged violation from line 92 to line 133. Nothing was fixed and
nothing was broken — a pure coordinate shift invalidated the ledger row.

## The anchor-mutex hole

The dispatch protocol prevents concurrent agents from EDITING the same file (`file_anchors`
intersection is refused by `gate:task-claim:anchor-overlap`). It says nothing about an agent whose
DATA references a file another agent owns. eps` anchors were `scripts/**`; it never touched
delta`s file — it merely recorded 58 line numbers inside it. Anchor overlap was zero by the
gate`s definition and total in effect.

Generalises to any generated artifact keyed by source coordinates: baseline ledgers, snapshot
files, line-numbered suppression lists, coverage exclusions, `:line` references in docs and specs.
Whoever OWNS such an artifact is coupled to every file it cites, and the current gate cannot see it.

## Why the oracle still deserves credit

This is the ledger working as designed (D6: new debt is never exempt; an orphaned row fails loud
rather than being silently dropped). Had it silently re-exempted by path alone, the shift would
have passed unnoticed and the ledger would have started drifting away from the debt it documents.
Exit 5 vs exit 2 being distinct is what made the diagnosis immediate: the row needed UPDATING, not
deleting, and only the two-way signal says so.

## Immediate repair applied

Ledger row line 92 -> 133, with the reason field recording WHY it moved and that the violation
itself is unchanged and still unfixed (commit 97c462e). Full suite green afterwards: vitest 416
files / 7171 passed, bun 1662 pass / 0 fail, clean tree.

## What this argues for (NOT built here)

A coordinate-keyed ledger is inherently fragile against insertion. Candidates, in ascending cost:
(1) match on a content fingerprint of the test title rather than a line number — the title is what
identifies the case, the line is an accident of layout; (2) have the oracle offer the corrected
coordinate in its exit-5 message (it already knows both ends of the diff); (3) at dispatch time,
treat "files cited by a generated artifact" as extended anchors for mutex purposes. (1) removes the
failure class rather than reporting it faster, and should be preferred.

## Standing rule for orchestrators

When one concurrent batch produces a generated artifact keyed by source coordinates, the full-suite
run after merging is not a formality — it is the ONLY place that coupling becomes visible. Scoped
per-worktree oracles cannot detect it: each agent measured a tree where the other`s change did not
exist.
