---
id: TASK-449
type: task
role: plan
title: "T2 — dangling-ac_ref detector plus its seeded-dangling fixture and exemption ledger"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-085
plan: PLAN-085
links:
  - {id: TASK-448, type: blocks}
---
## Task

Build `scripts/check-ac-ref-integrity.ts` — the corpus-wide dangling-`ac_ref`
detector specified in `spec-lore-ac-set-in-place-edit-of-a-declared-acceptance` D7 —
plus the seeded-dangling fixture that proves the assertion is live.

## Spec Reference

`spec-lore-ac-set-in-place-edit-of-a-declared-acceptance` §D7. Read the measured
table there: three real dangling refs exist in this corpus TODAY, so a first run
against the repo corpus is expected to be RED. That is the correct starting state,
not a bug in your detector — T3 dispositions them.

## Acceptance Criteria

Owns AC-ACS-7. Both halves are required and the negative half is the load-bearing
one: a detector that only ever runs green is indistinguishable from one that measures
nothing. Declare `--ac-scope AC-ACS-7` at claim time.

## Context Digest

- Input edge: for every `task` doc, `extra.verification_evidence[].ac_ref` (nullable —
  rows without one are simply not part of this check). Resolve the governing spec and
  assert the id is present in that spec's `extra.acceptance_criteria[].id`.
- **`spawnSync` capturing a `--json` payload MUST set an explicit `maxBuffer`** — the
  1 MiB default silently truncates, and this corpus is well past that (a probe over
  1100+ docs). A truncated payload parses as "fewer refs", i.e. a false green. Prefer
  reading through the service layer over shelling out per doc if the script can.
- Reference numbers from the 2026-08-01 probe, useful as a sanity floor: 636 declared
  AC ids, 2164 evidence rows carrying an `ac_ref`, 3 distinct dangling. If your run
  reports materially fewer rows scanned, suspect truncation before suspecting the
  corpus.
- Output must name each offending `(task, ac_ref)` pair — a bare count cannot be acted
  on.
- The exemption channel D7 option 2 needs: the detector reads an auditable ledger of
  retired ids and treats a listed `(spec, id)` as non-dangling. Ledger rows carry id,
  spec, date, reason. Model it on the `check:test-budgets` baseline ledger
  (`adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`) — same shape, same
  auditability requirement.
- ⛔ The fixture corpus is `mkdtemp` + `lore init`, NEVER the repo's own `.lore/`.
  See `packages/dashboard/tests/e2e/global-setup.ts` for the canonical pattern.

## File Anchors

- `scripts/check-ac-ref-integrity.ts`
- `scripts/tests/check-ac-ref-integrity.test.ts`
- `package.json`

## Verification discipline

Measure the exit code without a pipe (`cmd > out 2>&1; echo $?`). Assert the RED
fixture case first, then the green case — in that order, so a detector that cannot
fail is caught before it is trusted.
