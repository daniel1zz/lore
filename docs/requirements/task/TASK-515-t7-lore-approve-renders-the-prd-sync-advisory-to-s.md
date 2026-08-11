---
id: TASK-515
type: task
role: plan
title: "T7 lore approve renders the prd_sync advisory to stderr"
status: archived
priority: medium
phase: "Gate wiring"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-102
plan: PLAN-102
links:
  - {id: TASK-512, type: blocks}
---
## Task Objective

Make the `prd_sync` plan-promote advisory reach the operator. T1 landed it as a service-layer return value (`ApproveResult.prd_sync_advisories`), and `lore approve` never prints it — an advisory the CLI drops does not exist for the human it was written for, which is the same "the signal exists but nothing reads it" defect this spec exists to close.

Deliver, in `packages/lore/src/adapters/cli/commands/approve.ts`:

1. Render every `prd_sync_advisories` entry to **stderr**, immediately after the existing `reachability_advisories` loop (around line 99), on the same channel and with the same never-changes-the-outcome contract: exit code stays 0 whether or not advisory lines print, and nothing goes to stdout.
2. Keep the two arrays' rendering DISTINCT in code — do not concatenate them into one loop over a merged list. They are separate keys precisely because `reachability_advisories` keeps its exact shipped meaning; a merged loop would make a future reader believe one field carries both classes.
3. Absent or empty field prints nothing (the common case: a non-plan approval, or a plan whose ancestor spec resolves a domain doc).

## Spec Reference

`spec-plan-close-predicates-measure-invariants-an-applicability` §D2 — "an inapplicable verdict is loud on two channels". The audit row is the auditor's channel; this task is the operator's. Also §D2's rule that `reachability_advisories` never widens its meaning.

## Acceptance Criteria

- AC-PCI-16 `bunx vitest run packages/lore/tests/unit/cli/approve-advisory-render.test.ts -t 'advisory render'`

`-t 'advisory render'` is a contract — the test name must contain it verbatim. Required scenarios: a `prd_sync_advisories` entry prints to stderr and not stdout; exit code is unchanged (0) when it prints; both arrays present prints both, in a distinguishable order; both absent prints nothing. Write the RED test first and record the red run as `--result expected-fail` evidence.

## Context Digest

- The existing loop is `for (const advisory of doc.reachability_advisories ?? []) { process.stderr.write(...) }` with a comment block above it stating the advisory-never-changes-the-outcome rule — read that comment and extend the same discipline rather than inventing a new convention.
- T1 (merged, 43c8d78) added the field on `ApproveResult` and the `planPromotePrdSyncAdvisories()` enforcer method; the data is already flowing to this call site.
- This is the SECOND time this class of gap has been recorded in this repo: a writer whose reader was retired, and a reader without a writer, both fail SILENT. Every distribution pipe needs an author→visible oracle, which is what AC-PCI-16 is.

## File Anchors

- `packages/lore/src/adapters/cli/commands/approve.ts`
- `packages/lore/tests/unit/cli/approve-advisory-render.test.ts` — NEW
