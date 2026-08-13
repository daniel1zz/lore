---
id: PLAN-006
type: plan
role: plan
title: "SPEC-027 Implementation — Dashboard Hardening"
status: archived
priority: high
created: 2026-07-03
updated: 2026-07-03
tags: [dashboard, hardening, spec-027]
parent: SPEC-027
phases:
  - {name: "hardening", description: "Wave 1: three disjoint file clusters in parallel (P1 bugfixes / DiffView / CORS)"}
  - {name: "surface", description: "Wave 2 after merge: delete+restore UI, write-component tests"}
  - {name: "closeout", description: "CLAUDE.md sync, full oracle suite, assess + eval"}
---
# SPEC-027 Implementation — Dashboard Hardening

Executes SPEC-027 (dashboard write-path integrity, delete/restore surface, component test coverage) via parallel worktree agents, tracked with SPEC-025 claim/evidence, judged at closeout by SPEC-026 `lore assess --diff`.

## Phasing (grouped by file-anchor intersection, not by theme)

- **hardening** — three mutually disjoint file clusters, dispatched in parallel:
  1. P1 bugfix cluster: `routes/docs.$id.tsx` + `components/DocDetail.tsx` (+ `StatusPill.tsx` if transition wiring lives there) + regression tests. Fixes AC-DH-1/2/3 together because they share files.
  2. DiffView extraction: `components/HistoryTab.tsx` + `components/ConflictModal.tsx` → new shared `components/DiffView.tsx` (AC-DH-4).
  3. CORS origin echo: `packages/lore/src/adapters/http/middleware.ts` + tests (AC-DH-5).
- **surface** — after hardening merges (both tasks touch files modified in wave 1):
  4. Delete/restore: cookie routes in `dashboard-routes.ts` + UI entries in `DocDetail.tsx` (delete) and `HistoryTab.tsx` (restore) + HistoryTab component tests including restore (AC-DH-6/7).
  5. Component tests for Editor / NewDocModal / StatusPill / LinksPanel / ConflictModal (HistoryTab is owned by task 4 to avoid file collision) (AC-DH-8).
- **closeout** —
  6. Sync `packages/dashboard/CLAUDE.md` (AC-DH-10), run the full oracle suite (AC-DH-9), then `lore assess <this-plan> --diff <base..HEAD>` and `lore eval`.

## Execution protocol (SPEC-025 dogfood)

Every implementer must, inside its worktree session:
1. `lore claim <task-id> --by <agent-name> --branch <worktree-branch>` before touching code.
2. Run real oracles (tsc / vitest / bun test) and record each with `lore evidence <task-id> --oracle <kind> --command "<cmd>" --result <pass|fail> --output-tail "<tail>" --by <agent-name>` — failures are recorded too, not only passes.
3. `lore release <task-id> --by <agent-name>` when done.
Main agent merges each returned branch immediately (`--no-ff`), then archives the task.

## Verification

Closeout gate = AC-DH-9 oracle suite + `lore ready` shows no unexpectedly blocked tasks + assessment doc produced and linked (`informs`) to this plan.
