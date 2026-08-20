---
id: TASK-735
type: task
role: plan
title: "Rename the pre-push trip test to match the two suites it holds, and converge all four records of the old name in the same change"
status: archived
priority: high
phase: "follow-ups"
created: 2026-08-18
updated: 2026-08-18
tags: []
parent: PLAN-131
plan: PLAN-131
---
Implements AC-BFI-11 of spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor.

## Objective

Rename `packages/lore/tests/integration/pre-push-binary-provenance-trip.bun.test.ts`
to `packages/lore/tests/integration/pre-push-trip.bun.test.ts` — the file holds TWO
suites (`AC-BFI-3: the pre-push hook actually RUNS the binary-provenance check` at
line 198, `AC-BFI-9: the pre-push hook actually RUNS the anchor-coverage ratchet` at
line 295), so its current name asserts a scope narrower than its contents.

Use `git mv` so history follows.

## The rename is not done when the file moves

Every place that RECORDS the old name becomes a stale assertion the moment the file
moves. All four MUST converge in this task:

1. This spec's `code_anchors` — the corpus is the SSOT, so use
   `lore anchor add` / `lore anchor set`, not the exported mirror under
   `docs/requirements/`. Verify with `lore status --check-drift`.
2. `packages/lore/tests/unit/assets/pre-push-parity.test.ts:130` — a comment naming
   the old basename.
3. The renamed file's OWN internal diagnostic at line 159, which prefixes its message
   with `pre-push-binary-provenance-trip:`.
4. Root `CLAUDE.md` line 46, which instructs the reader to run the old basename BY HAND.

Find any site you were not told about with
`git grep -n pre-push-binary-provenance-trip`.

## Deliberately NOT rewritten

Historical knowledge docs under `docs/requirements/`. They record past measurements;
AC-BFI-11's git-grep clause excludes that directory for exactly this reason. Do not
"fix" them.

## Red first

Before renaming, run the AC command and record the red (it fails on the first
`test -f`). Record it with
`lore evidence <task> --oracle test --command "<cmd>" --result expected-fail`
at the moment it is red, from inside your own worktree. Then, after the rename,
re-introduce the old basename into ONE of the four record sites and confirm the
git-grep clause turns the command red again — that is what proves the clause is live
rather than decorative. Record that second red too.

## Note on the assets manifest

`hooks/pre-push` and `assets/project/pre-push` are parity-pinned and are NOT touched by
this task. If you find yourself editing `assets/`, stop — you have left the task.
