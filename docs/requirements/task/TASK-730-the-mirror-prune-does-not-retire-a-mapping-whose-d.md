---
id: TASK-730
type: task
role: plan
title: "The mirror prune does not retire a mapping whose doc was soft-deleted, so KN-025 keeps its mirror file and index entry forever and short-circuits the whole bun test half"
status: archived
priority: critical
phase: "readonly-oracle"
created: 2026-08-13
updated: 2026-08-17
tags: []
parent: PLAN-124
plan: PLAN-124
---
The mirror prune retires a file that no corpus doc claims, but it does NOT retire a
mapping whose doc was SOFT-DELETED. So a deleted doc keeps both its mirror file and its
`.lore/export-index.json` entry indefinitely, and every corpus-wide parity oracle reports
it as a defect forever.

## Measured on main 2026-08-13, after the frontmatter-convergence fix landed

`bunx vitest run scripts/tests/mirror-status-parity.test.ts` fails with exactly ONE
problem, and it is the only red in the entire 511-file vitest suite:

    kind: orphan_mapping
    detail: export-index maps 01KWVPCJBKHPTBZQBPMXZK0B99 ->
            docs/requirements/knowledge/KN-025-assessment-spec-035-implementation-audit-trail-cal.md,
            but no live corpus doc has this id

`lore get 01KWVPCJBKHPTBZQBPMXZK0B99` resolves: slug
`knowledge-assessment-spec-035-implementation-audit-trail-calibra`, status `draft`,
**`deleted_at: 2026-07-18T13:40:11.538Z`**. So the doc is soft-deleted, not missing — which
is why the existing prune does not see it as an orphan file: the mapping still claims it.

## Why this must be fixed at the prune, not by deleting the file

⛔ Hand-deleting the file and its mapping would turn the oracle green while leaving the
mechanism unchanged — the next soft-delete recreates the same residue, and the oracle would
red again with no code having regressed. That is the "repair the symptom, keep the defect"
shape this spec exists to eliminate.

The prune must treat "mapping resolves to a doc whose `deleted_at` is set" as a retirement
condition: drop the mapping and remove the mirror file, or — if retiring it is deliberately
out of policy — report it as DECLINED with the reason, which AC-OX-5's honest-report clause
already requires of every file the exporter will not repair. ⛔ What it must not do is stay
silent, which is the current behaviour.

## Consequence while this is open

`bun run test` is `test:vitest && test:bun && check:spec-mirror`. This single red
SHORT-CIRCUITS the chain, so the entire bun half (2141 tests across ~200 files) and the
mirror parity check never run under `bun run test` at all. Measured this session: the
full-suite run reported `Test Files 1 failed | 510 passed` and produced NO bun-half summary.
That makes this a suite-availability defect, not only a parity nit — it must be fixed or
explicitly waived before any future session can trust a green `bun run test`.

⛔ Note for whoever picks this up: source the live-doc population with
`lore list --include-invalid`. The default list silently omits invalidated docs behind a
self-consistent total, and a census built on it reported 21 orphans against a true 1
(`knowledge-eleven-findings-from-resuming-handoff-102-with-three` §1).
