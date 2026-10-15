---
id: PLAN-157
type: plan
role: plan
title: "Session-start injection carries only the seat's own items"
status: archived
priority: medium
created: 2026-10-11
updated: 2026-10-12
tags: []
parent: SPEC-166
phases:
  - {name: "core-service-cli", description: "Projection, seat claims read, CLI empty-print, knob retirement, old-test retirement"}
  - {name: "hook", description: "Phase E empty handling, spawn order, --seat-path"}
  - {name: "prose", description: "Shipped prose: pull instead of consume"}
---
# Plan — Session-start injection carries only the seat's own items

Implements `spec-session-start-injection-carries-only-the-session-s-own` (AC-SI-1..12), baseline leaf `baseline-start-a-session` (BR-326, BR-328, BR-329, BR-981). Governance: batched — S1 decided with the user 2026-10-11 (seat-only payload, drop `my_claims`, specs stay unedited); paused for issue #155 (living vs record), resumed after `plan-documents-are-living-or-records-record-edit-gate` closed. Re-checked against that mechanism: the old SPEC-080 / context-provenance / handoff-neutrality specs are locked records and stay unedited (D9); the leaf is living and is edited in place; D11 (match a claim by branch name OR worktree path) and D12 (realpath port) added on resume and in S3 because claims in the closed plan were measured recording paths (issue #158).

## Overview

`buildBootstrapInjection` returns `null` unless the session sits in a seat with an unfinished claim or a seat-plan handoff; `SessionService.seatClaims(BootstrapSeatSignal)` supplies the claims (branch name or realpath-matched directory, D11/D12); `lore bootstrap --injection` prints nothing when empty; the hook treats empty as "nothing to inject", not degradation; shipped prose stops telling agents the bootstrap is hook-injected.

## Tasks and order

| Task | ACs | Blocked by | Why the order |
|---|---|---|---|
| core + service + CLI | AC-SI-1, 2, 4, 6, 8, 9, 10, 11 | — | the binary must accept the seat flags before the hook sends them |
| hook Phase E | AC-SI-3, 7, 12 | core + service + CLI | a hook that passes `--seat-worktree` to a binary that ignores it injects nothing for path-recorded claims |
| prose sweep | AC-SI-5, 7 | hook Phase E | both regenerate `packages/lore/src/generated/assets-manifest.ts` |

## Invariants (checked at every merge)

| # | Invariant | How it is checked |
|---|---|---|
| I1 | Full report unchanged (`lore bootstrap --json`, MCP `lore_bootstrap`) | AC-SI-9 + AC-SI-2(e) |
| I2 | New behaviour asserted only in NEW test files; old files only lose retired assertions — exceptions: rename-only constant edits from the D8 split in `mcp-session-tools.test.ts` (AC-SI-9), `cli-feed-task-start.bun.test.ts`, `resume-coverage-constants.test.ts` and `feed-flow-resume-closure.test.ts`, no assertion change | AC-SI-11 + diff review of the old files |
| I3 | No test writes the repository's live `.lore/` | new tests use InMemoryStore or `mkdtemp` + `lore init` |
| I4 | After each merge on main: typecheck exit 0, changed-scope tests green, `bun run build` exit 0 — except between task 1 and task 2 (R4), checked once after task 2 | orchestrator, unscoped re-verify on main |

## Risk register

| # | Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | Seat never matches its own claims | H | claim recorded in a form the match ignores | D11 matches branch name and realpath; AC-SI-2(b2), AC-SI-10 | none needed once #158 normalises the stored form |
| R2 | An agent relied on the injected corpus-global fields | M | agent skips `lore bootstrap` and works blind | prose sweep (AC-SI-5) names the pull commands | add the field back only through D4's closed allowlist |
| R4 | Binary ahead of hook between merges | M | task 1 merged and `dist/lore` rebuilt while main's hook still passes only `--seat-branch` → seat runs exit 2 (AC-SI-2(g)), main-checkout runs print empty and the old hook records degradation for every session | merge task 1 and task 2 back-to-back: do not run `bun run build` on main between them; I4 (build + changed-scope tests incl. existing hook→dist/lore e2e) runs once after task 2 merges | revert the task 1 merge if task 2 fails its retry budget |
| R3 | Falsifiers cannot be declared after approval | M | `ac set --falsifier-*` refused on a locked spec (#162) | declare falsifiers before approval where the find-text already exists, else wait for #162 | statements already name each smallest red mutation |

## Decisions Log

- 2026-10-11 — S1 answers recorded in the spec's D1–D10; D11 added on resume (seat identity).
- 2026-10-11 — D12 added in S3 round 1 (realpath port: a claim path and the seat path are compared after symlink resolution; ENOENT falls back to `path.resolve`).
- 2026-10-12 — S4 approval given by the user (status flips on `lore approve`); the leaf's in-place edit (BR-328 wording, held-table row) was done during S2/S3, so no task owns a further leaf edit — confirming BR-328/329/981 after AC-SI-1/2 pass is a plan-close step.
- 2026-10-12 — Task 1 measured two criterion defects (AC-SI-9 pinned session-service.test.ts unedited though it carried a retired caps case; AC-SI-11 grepped a file D10 retires whole). Reopen was refused (evidence existed); the user chose to fix the mechanism first (#168, plan-a-criterion-of-a-locked-specification-can-be-fixed-as-an, closed). Both criteria then fixed with `lore ac set --correction`; AC-SI-2/4 commands gained the missing build step; falsifiers deferred by #162 declared for AC-SI-1/2/3/4/10/12, each measured red first (spec Corrections: 8).
- 2026-10-12 — R4 held: task 1 and task 2 merged back-to-back, rebuild after task 2.
- 2026-10-12 — UAT by an independent subagent: P0 6/6, P1 3/3 accepted, no defect (uiux not applicable: no UI surface; min_dimension_score recorded as 100). lore assess: met 84; its seatClaims blast-radius finding filed as #172.
- 2026-10-12 — BR-328/329/981 promoted to established (AC-SI-1/2 runner-attested); leaf Q5 closed.
