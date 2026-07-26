---
id: SPEC-077
type: spec
role: spec
title: "SPEC-077 — Dashboard execution read surface (PRD §21 F3)"
status: approved
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
## Overview/Goal

PRD §21 F3 (committed second batch, owner build directive 2026-07-25): the dashboard **execution read surface** — a read-only UI layer over execution state that already exists in the corpus but is only reachable via CLI today. One new page (`/execution`) renders, for a selected plan: ready/blocked tasks with claim TTL countdown, derived sessions, anchor conflicts, and phase progress scorecards; per-task evidence timelines are reached by zero-step navigation into the existing SPEC-075 Evidence tab (SSOT — no duplicate timeline component). Strictly read-only: execution verbs (claim/release/evidence) stay CLI-only per the standing ideation consensus; write affordances require the independent F4(iii) owner reversal and are OUT of this spec.

Design round: module mode (this document). Gates passed: no new circular dependencies (panels depend only on `lib/api` + `types`); each component has a single responsibility; panels are pure-props and black-box component-testable; server-side derivation stays in existing DI'd services (`TaskWorkflowService.ready`, `PhaseWorkflowService`).

## Scope

### S1 — `/execution` route + nav entry (packages/dashboard)
- New TanStack route `/execution` with a nav entry in the root layout (same pattern as the Issues nav entry). Route participates in F2 route telemetry automatically via the existing `use-route-telemetry` pathname hook (`route_id = /execution` — no new telemetry code).
- Plan selector: lists active plans (existing bootstrap/list read surface), selection held in the `?plan=<idOrSlug>` search param for deep-linking; defaults to the most recently active plan when the param is absent.
- Page fetches exactly two read projections for the selected plan: `GET /api/ready/:planIdOrSlug` (exists, SPEC-037 D1) and `GET /api/phase-status/:planIdOrSlug` (NEW, pinned below), via the established `useSuspenseQuery` + query-key pattern in `lib/api.ts`.

### S2 — Read-only panels (all pure-props, packages/dashboard/src/components)
- `ReadyTaskList` — one row per `ReadyReport.records[]` entry: task title/slug/status, ready/blocked badge with unmet-blocker slugs, evidence count, and a claim badge with three states: fresh claim → holder + remaining-minutes countdown (`claim_ttl_minutes − age_minutes`, clamped at 0); stale claim → holder + "stale" label; no claim → no badge. Row click navigates to `/docs/$id` (Evidence tab reachable there — this IS the F3 "evidence timelines" surface, by linkage not duplication).
- `SessionsPanel` — one row per derived session `(by, machine, worktree)` with its held-task count. Empty state: explicit "no active sessions" text.
- `AnchorConflictsPanel` — one row per `anchor_conflicts[]` entry naming both holders and the overlapping path. Empty state: explicit text.
- `PhaseProgressPanel` — one scorecard per phase from the NEW phase-status route: attested-AC counts (`a/b attested`), checklist item states, dropped items named, `vacuous` badge when the §18 D3 anti-vacuous invariant fires, and manual-vs-attested trust labels rendered verbatim from the projection (never re-derived client-side). Plans without phases → panel renders its explicit empty state.

### S3 — NEW spec-pinned read route (SPEC-036 shape-drift discipline)
`GET /api/phase-status/:planIdOrSlug` (packages/lore/src/adapters/http):
- Auth: cookie OR bearer (standard v1 read-family duality, same as `/api/ready`).
- 200 response shape (pinned, corrected 2026-07-25 to the AS-BUILT `PhaseWorkflowService.planPhaseStatus` projection after the T1/T2 parallel-wave drift was caught by the T3 e2e): `{ ok: true, data: { plan: { id, slug, title }, phases: PhaseScorecard[] } }` where `PhaseScorecard` = `{ phase_id, phase_slug, phase_title, state, vacuous: boolean, ac_scope: { total, attested, blocking[] }, checklist: { total, satisfied, blocking[], dropped_named[], manual_selfattested[] }, checklist_items: { id, statement, state: "satisfied"|"blocking"|"dropped", trust: "manual"|"attested" }[], blocking[], claim: { by, at, stale }|null, task_count }`. There is NO `dropped_item_names` wire field — dropped names derive from `checklist_items` with the `dropped` state. The service types in `packages/lore/src/service/phase-workflow-service.ts` are the SSOT; the dashboard client in `lib/api.ts` mirrors them byte-for-byte; the route adds NO derivation.
- Plan with zero phases → 200 with `phases: []` (not an error). Unknown id/slug → 404 `DOC_NOT_FOUND`. Resolvable doc that is not type `plan` → 422 `VALIDATION_ERROR` naming the actual type (same semantics as the evidence-panel route's non-member case).

### S4 — Additive field on the ready route (pinned here per SPEC-036)
`GET /api/ready/:planIdOrSlug` response gains top-level `claim_ttl_minutes: number` (the resolved `workflow.claim_ttl_minutes` config value, HTTP-layer enrichment; core `ReadyReport` stays pure). Additive and optional for existing consumers; the countdown in S2 divides UI state by it — the UI never hardcodes the TTL.

### S5 — Doc-sync
Fix the stale `packages/dashboard/CLAUDE.md` line claiming the ready route has no dashboard consumer; document the new route family + panels there and in the http adapter CLAUDE.md.

### Non-goals
- No execution-verb writes (claim/release/evidence buttons) — F4(iii) reversal required.
- No new telemetry sink or events beyond the existing route-view POST.
- No home-page identity change (§13.5 unchanged); `/execution` is a sibling page, not a home redesign.
- No pagination on v1 panels: a plan's ready records/sessions/conflicts are bounded by plan size (tens, not thousands); revisit only on measured need.

## Acceptance Criteria

Structured ACs live in `extra.acceptance_criteria` (added via `lore ac add`, all script-mode). Summary: component tests for the four panels' populated + empty + boundary states (AC-1/2/3), backend route contract incl. auth duality and error semantics (AC-4), Playwright e2e over a seeded gate-conformant corpus exercising nav → plan selection → all four panels → task drilldown to Evidence tab (AC-5), and route-telemetry attribution for `/execution` (AC-6).

## Cross-cutting
- Security: read-only routes behind the existing auth gate; no new write surface; no CSRF surface added (GET only).
- Performance: two suspense queries per plan selection; no polling — countdown ticks client-side from fetched age/TTL without refetching (staleness is display-only; a manual refresh affordance re-runs the queries).
- Observability: F2 route telemetry covers usage attribution (`route_id = /execution`) — this is the field the §21 kill criterion reads.
- Privacy: local-only data, no doc content leaves the machine.


## Acceptance Criteria (structured)

- [✔] [script] AC-077-1: ReadyTaskList renders one row per fixture record; the claim badge covers all three states — fresh claim shows holder plus remaining minutes computed as claim_ttl_minutes minus age_minutes clamped at 0, stale claim shows holder plus the literal label 'stale', absent claim renders no badge; ExecutionPage syncs plan selection to the ?plan search param
  script: test — cd packages/dashboard && bunx vitest run tests/component/ExecutionPage.test.tsx tests/component/ReadyTaskList.test.tsx
- [✔] [script] AC-077-2: SessionsPanel renders one row per derived session keyed by (by, machine, worktree) with its held-task count; AnchorConflictsPanel renders one row per conflict naming both holders and the overlapping path; each renders its literal empty-state text for an empty array
  script: test — cd packages/dashboard && bunx vitest run tests/component/SessionsPanel.test.tsx tests/component/AnchorConflictsPanel.test.tsx
- [✔] [script] AC-077-3: PhaseProgressPanel renders one scorecard per phase carrying attested counts in a/b form, per-item checklist states, dropped item names, a vacuous badge exactly when the projection vacuous flag is true, and manual-vs-attested trust labels taken verbatim from the projection; zero phases renders the literal empty-state text
  script: test — cd packages/dashboard && bunx vitest run tests/component/PhaseProgressPanel.test.tsx
- [✔] [script] AC-077-4: GET /api/phase-status/:planIdOrSlug returns 200 with the pinned {plan:{id,slug,title},phases:[]} shape (phases populated for a plan with phases, empty array for a plan without), 404 DOC_NOT_FOUND for an unknown id, 422 VALIDATION_ERROR naming the actual type for a non-plan doc, and accepts both cookie and bearer auth; GET /api/ready/:planIdOrSlug response carries top-level claim_ttl_minutes equal to the resolved workflow.claim_ttl_minutes config value
  script: test — cd packages/lore && bun test tests/http/phase-status.bun.test.ts tests/unit/adapters/http/ready-route.bun.test.ts
- [✘] [script] AC-077-5: Playwright: the nav entry reaches /execution; the seeded plan renders at least one ready task row with a claim badge, one session row, one anchor-conflict row and one phase scorecard; clicking the task row navigates to the doc detail page with the Evidence tab visible
  script: e2e — cd packages/dashboard && bunx playwright test tests/e2e/execution.pw.ts
- [✔] [script] AC-077-6: Navigating to /execution issues exactly one POST /api/dashboard/telemetry/route-view whose payload route_id equals /execution
  script: test — cd packages/dashboard && bunx vitest run tests/unit/lib/use-route-telemetry.test.ts
