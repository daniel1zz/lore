---
id: PLAN-158
type: plan
role: plan
title: "A criterion of a locked specification can be fixed as an audited correction"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: SPEC-170
phases:
  - {name: "criterion-correction", description: "ac set --correction through service, CLI, refusal text and prose"}
links:
  - {id: TASK-991, type: resolves}
  - {id: TASK-1002, type: resolves}
---
# Plan — A criterion of a locked specification can be fixed as an audited correction

Implements `spec-a-criterion-of-a-locked-specification-can-be-fixed-as-an` (AC-CC-1..4), baseline leaf `baseline-keep-a-record-unchanged` (BR-1069). Issue #168, closes #162. Governance: batched — S1 decided by the user 2026-10-12 ("先修 #168": fix the mechanism before resuming `plan-session-start-injection-carries-only-the-seat-s-own-items`, which is blocked on two criterion defects).

## Overview

One task: thread `correction?: { reason }` through `AcService.setCriterion` (skip only the record-edit gate and the demotion, mark the version + audit row exactly as `CorpusService.set` does), add `--correction` to `lore ac set` with an argv-level empty-reason refusal, refuse `--correction` on `ac add|rm` with a pointer to `ac set`, make the criterion refusal text name the exit, and update the produce-rule asset, its installed copy and root CLAUDE.md.

## Invariants

| # | Invariant | How it is checked |
|---|---|---|
| I1 | Without `--correction`, every existing criterion refusal keeps its exit code (its text gains the `ac set --correction` pointer) | AC-CC-1(b), AC-CC-2(b); existing record-lock tests stay green |
| I2 | No test writes the repository's live `.lore/` | InMemoryStore / `mkdtemp` + `lore init` |
| I3 | Root CLAUDE.md under its eviction floor; parity literals intact | `lore status --check-claude-md` exit 0; `claude-md-eviction-floor.test.ts`, `phase-write-lifecycle-doc-parity.test.ts` |
| I4 | After merge on main: typecheck 0, changed-scope tests green, `bun run build` 0 | orchestrator re-verify on main |

## Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Correction becomes the routine way to change a spec's meaning | M | BR-1069 limits it to one existing criterion with a recorded, counted reason; add/rm stay refused; `lore get` shows the count; the B1 branch of the parent mechanism (corrections ÷ refusals > 50% after 14 days → report) already watches misuse |
| R2 | Root CLAUDE.md has ~250 bytes of headroom | L | extend the existing "Exits:" sentence and the existing standing lesson in place; no new sentence |

## Next

After merge: use `lore ac set --correction` to fix AC-SI-9 and AC-SI-11 on `spec-session-start-injection-carries-only-the-session-s-own`, declare the deferred falsifiers (#162), then resume that plan at the task-1 merge.

## Decisions Log

- 2026-10-12 — user chose "fix #168 first" over whole-spec supersession or proceeding with known-false criteria.
