---
id: TASK-742
type: task
role: plan
title: "Land the adopted resolution state, its required owner pointer, the abandonment count, and the compiled-CLI wiring"
status: draft
priority: high
phase: "m7"
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-132
plan: PLAN-132
---
# Task Objective

Implement M7 end to end: a non-terminal `adopted` resolution that frees defect-channel quota,
requires a live owner, and whose abandonment is counted and enumerable — plus the compiled-CLI
proof.

# Spec Reference

`spec-the-defect-channel-cannot-be-honestly-maintained-an` §M7 (the addendum near the end of
the document) and `AC-DC-14` … `AC-DC-17`. ⛔ Read the statements with `lore ac list` — they are
the contract; this file is orientation. Read M1, M2, M3 and M6 too: M7 touches M1's seam and
inherits M3's pointer reasoning and M6's "the constrained party must not control the ceiling"
argument.

# What exists today, read 2026-08-21

| Thing | Where |
|---|---|
| the 8-state vocabulary + the terminal subset literal | `packages/core/src/issue-resolution-vocab.ts` (`ISSUE_RESOLUTION_MEMBERS`, `TERMINAL_ISSUE_RESOLUTION_MEMBERS`, `NON_TERMINAL_ISSUE_RESOLUTION_MEMBERS`) |
| the quota candidate count | `countOpenReports`, `packages/core/src/issue-report.ts:361` |
| computed-resolution derivation | `packages/lore/src/service/issue-resolution.ts` |
| the cap ceiling seam | `resolveOpenReportCap`, `packages/core/src/config.ts` |
| the `resolve` CLI verb | `packages/lore/src/adapters/cli/commands/issue.ts` |
| count fields + the `--enumerate` registry | `packages/lore/src/adapters/cli/commands/status.ts` (field registry ~line 750) |

⛔ `AC-DC-9` asserts REPO-WIDE that the terminal member set has exactly ONE construction site.
Adding a state means touching that vocabulary module and nothing else — if you find yourself
writing the member list a second time, stop; `AC-DC-9` will go red and it is right to.

⛔ `NON_TERMINAL_ISSUE_RESOLUTION_MEMBERS` already exists. `adopted` belongs there, NOT in the
terminal set. Read both before adding, and check whether `--resolved`'s complement is derived
from one or listed separately.

# What to build

1. **`adopted` as a non-terminal resolution state** in the vocabulary module. It must NOT join
   `TERMINAL_ISSUE_RESOLUTIONS` — `AC-DC-14` control (a) asserts the adopted report is still
   listed as unfinished, and `AC-DC-1`'s statement now explicitly excludes `adopted` from the
   states it accepts, so a mistake here reddens two criteria.
2. **`lore issue resolve --state adopted --adopted-by <plan-or-task>`.** The pointer is
   REQUIRED, must resolve to an existing doc, and that doc's type must be `plan` or `task`.
   Refusal is exit EXACTLY 4 and writes NOTHING — assert the target's `extra` is byte-identical
   afterwards (`AC-DC-15`).
3. **Quota occupancy through ONE seam.** The cap's candidate set is narrowed by
   `TERMINAL_ISSUE_RESOLUTIONS` ∪ `{adopted}`. `AC-DC-14` compares the seam's member set AS A
   SET against that union — ⛔ never against a literal list typed into the test.
4. **The abandonment count + its enumerator.** Three conjuncts, all from stored fields:
   `resolution.state === "adopted"` AND the `adopted_by` target resolves to a doc whose status
   is `archived` or `deprecated` AND the report itself carries no terminal resolution. Register
   it as a count field WITH a sibling `--enumerate` entry whose member count EQUALS the
   reported number — that is `AC-FR-5`'s standing rule for every count field, and
   `status.ts`'s registry is where the existing fields do it.
5. **The compiled-CLI e2e** at `packages/lore/tests/e2e/issue-adopt-compiled.bun.test.ts`.
   Pre-flight `lore status --check-binary-provenance` through the resolved dist path and
   require exit EXACTLY 0; a stale binary FAILS the suite loudly naming built-from and HEAD.
   ⛔ Never skip on staleness — a skipped wiring check is indistinguishable from a passing one.

⛔ NOT in scope, explicitly: auto-creating the owning plan or task. An adopt verb that mints its
own owner lets a caller free quota without anyone deciding to do the work.

⛔ Do NOT resolve any of this repo's ten real open reports as part of this task. They are live
records of unfixed defects; adopting them is a corpus decision for the orchestrator, made after
this mechanism exists and is verified.

# Verification discipline

- ⛔ Red first, recorded by YOU in this worktree at the moment it is red:
  `lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail`. A red
  described in your report and transcribed later is not evidence.
- ⛔ Every AC pass must be ATTESTED: `lore verify plan-land-m7-an-adopted-state-that-frees-defect-channel-quota --task <this task>`.
  ⛔ `lore evidence --capture` is NOT attested — it labels `capture_source: runner` but issues
  no attestation block, so pass/fail is still typed by you. Use it only outside the four ACs.
- ⛔ Run every declared RED, do not describe it: `AC-DC-14` (make `adopted` terminal → control
  (a) fails), `AC-DC-15` (accept an absent pointer → first case fails), `AC-DC-16` (all three
  seeds, including the two negative ones that stop the count degenerating into "every adopted
  report"), `AC-DC-17` (revert the candidate narrowing → accept case exits 4; point at a stale
  binary → provenance assertion fails rather than skips). Revert each after measuring.
- ⛔ Assert exit codes EXACTLY, never "non-zero". A tool dying early for an unrelated reason
  also exits non-zero, and that is how a reverse control ends up with no discriminating power.
- ⛔ `lore ac set` is permitted in THIS task only as the last step, to declare the
  `--falsifier-*` sets (all four flags required together), and only after the fix exists — a
  falsifier's `--falsifier-find` must match POST-FIX source. Then run `lore verify --falsify`
  WHILE THIS PLAN IS LIVE: measured 2026-08-21, a falsifier whose plan is archived can never
  be re-run (`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` F2 — all 8 existing
  declarations in this corpus are already dead for exactly that reason). Report that you ran
  `ac set`; the orchestrator restores the spec to `approved` after merging.
- ⛔ Scoped oracles only in this worktree: `bun run test:changed <base>`. It is structurally
  blind to `.bun.test.ts` via `vitest --changed`, so run your new `.bun.test.ts` explicitly,
  and it under-selects tree-scanning tests naming no literal path — `AC-DC-9`'s repo-wide
  uniqueness scan is exactly that shape, so run it BY HAND.
- ⛔ `packages/core` is a monorepo sub-package: build it before typechecking any
  `packages/lore` consumer of a new export, or the red you read is an artifact.
- ⛔ `@lore/core`'s default barrel must stay browser-safe — no top-level `fs`/`path`/`os`.
- ⛔ Never write to this repo's own `.lore/`. Every e2e uses `mkdtemp` + `lore init`.

# File Anchors

- `packages/core/src/issue-resolution-vocab.ts`
- `packages/core/src/issue-report.ts`
- `packages/lore/src/service/issue-resolution.ts`
- `packages/lore/src/adapters/cli/commands/issue.ts`
- `packages/lore/src/adapters/cli/commands/status.ts`
- `packages/lore/tests/unit/service/issue-resolution.test.ts`
- `packages/lore/tests/e2e/issue-adopt-compiled.bun.test.ts`
