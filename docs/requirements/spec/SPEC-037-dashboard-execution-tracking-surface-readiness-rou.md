---
id: SPEC-037
type: spec
role: spec
title: "Dashboard execution-tracking surface: readiness route + plan progress + evidence viewer"
status: deprecated
priority: high
created: 2026-07-07
updated: 2026-10-10
tags: [spec-037, dashboard, ux, execution-tracking, feedback-loop]
---
# SPEC-037 — Dashboard execution-tracking surface: readiness route + plan progress + evidence viewer

> Kind: feature (+design constraints). Parent: PRD-001 §13.5 (dashboard = corpus projection) + §14 (human-in-the-loop observation). Relates: SPEC-023 (phases), SPEC-025 (claim/evidence/readiness), SPEC-033 (home panels), SPEC-036 (type-differentiated presentation).
> Origin: product-lens 4-dimension review + dogfood empirical baseline, 2026-07-07 — all four dimensions converged on one root cause: the TRACK job (plan progress, agent claims, oracle evidence, readiness) has zero web projection while every datum already exists in the backend (the "projection gap"). This spec is Tier 0 + Tier 1 of that review's action plan.
> Consumer: implement (backend task + frontend task) → e2e verify in the real dashboard. Per the SPEC-036 precedent: spec→implement, no HTML-prototype gate — the visual language is fixed by the existing shadcn/Tailwind system (TYPE_ACCENT, formatTypeMetaLabel, JudgmentBadge, Badge/Card primitives); no new style direction is introduced.

## 0. Current-state facts (verified 2026-07-07)

| Fact | Location |
|---|---|
| `TaskWorkflowService.ready(planIdOrSlug, now?)` → `Result<ReadyRecord[], LoreError>` exists, zero-write, batch link fetch | `service/task-workflow-service.ts:380-440` |
| `ReadyRecord` already carries `task: DocSummary` (no `.meta` — deliberate narrow projection), `phase?`, `ready`, `unmet_blockers[]`, `claim?{…, stale, age_minutes}`, `latest_evidence?`, `evidence_count`, `upstream_unapproved?` | `core/task-workflow.ts:104-126, 192-203` |
| **No HTTP route exposes readiness** — `lore ready` is CLI/MCP-only; `ActivePlansPanel` documents itself as a stand-in ("not ready-aware" badge) | `http/routes.ts` (grep), `ActivePlansPanel.tsx:47-48` |
| HTTP read routes: central auth (cookie OR bearer) before dispatch; handlers get `actor`; envelope `jsonOk` → `{ok:true,data}` / `loreErrorResponse` maps code→status | `http/routes.ts:87-190`, `middleware.ts:24-80` |
| `navigation.children` already returns full `DocSummary` incl. `meta`/`tags`/`priority` (SPEC-036 `toSummary`) — the data for a rich plan-children list is already on the wire | `corpus-service.ts:487-489`, `dashboard/src/lib/api.ts:46` |
| `DocDetail` footer renders children as bare title-only buttons; consumes none of `child.meta` | `DocDetail.tsx:644-660` |
| Task `extra.verification_evidence[]`: `{oracle, command, result, output_tail?(≤4000), recorded_at, recorded_by}` max 50; `extra.claim`: `{by, at, branch?}`; plan `extra.phases[]`: `{name, description?}` max 30; task `extra.phase?` validated against parent plan | `core/task-workflow.ts:44-51,66-70`, `schemas.ts:149,154,168-171,197` |
| `DocTree` node click does BOTH toggle and `onSelect` (navigate) in one handler — expanding a collapsed node always navigates away; expansion is per-node `useState(depth < 2)`; keyboard (Enter/Space) exists but fires the same combined handler | `DocTree.tsx:34-87` |
| FTS snippet returns literal `[`/`]` highlight markers (`snippet(docs_fts,1,'[',']','...',32)`); dashboard renders them as plain text; `SearchHit` = `{id,slug,title,snippet,score}` — no type/status | `sqlite-store.ts:522,535-543`, `SearchResultCard.tsx:46-53` |
| Shared renderers to reuse: `TYPE_ACCENT` (+`TYPE_ACCENT_BORDER_CLASS`), `formatTypeMetaLabel`, `isNotablePriority`, `JudgmentBadge` | `lib/type-accent.ts:31-46`, `lib/type-meta-label.ts:36-64`, `judgment-badge.tsx` |
| Jargon strings: "not ready-aware" (`ActivePlansPanel.tsx:48`), "Adjudicate" (`TriageQueue.tsx:204`), "Optional calibration note…" (`TriageQueue.tsx:235`), `parent_id is required for type '…'` surfaced raw in `NewDocModal.tsx:238-240` (origin `schemas.ts:272` — shared with CLI, do not change core) | as cited |

Correction to the dogfood baseline (ISSUE-001/008): the tree DOES have a toggle and keyboard handling; the defect is that toggle and navigation share one gesture, so expanding always navigates away. This spec fixes the gesture split, not a missing handler.

## 1. Deliverables

### D1 — `GET /api/ready/:planIdOrSlug` + ActivePlansPanel wired to real readiness

**Backend** (adapter-thin; service untouched):

- New read route `GET /api/ready/:planIdOrSlug` in `handleApiRoute`: regex matcher (same style as `matchDocsPath`), handler calls `app.taskWorkflowService.ready(planIdOrSlug)` → `loreErrorResponse` on `!ok`, else `jsonOk(records)`. Inherits central dual (cookie/bearer) read auth — no per-route auth code. Non-plan target → the service's existing `VALIDATION_ERROR` (422 via the middleware map). No new service logic, no writes.
- MCP/CLI surfaces: unchanged (`lore_ready` / `lore ready` already exist).

**Frontend**:

- `api.ts` gains `apiGetReady(planIdOrSlug): Promise<Result<ReadyRecord[], ApiError>>` (read-only wrapper; response shape mirrors `core/task-workflow.ts` exactly, documented inline per the SPEC-033 convention).
- `ActivePlansPanel`: for each active plan (existing query kept), fetch readiness and render `N ready / M tasks` per plan row (ready = `ReadyRecord.ready`). Remove the `"not ready-aware"` stand-in badge and its tooltip. Query key `["home","ready",planId]`; plans with zero tasks render `no tasks` muted text, not a fabricated 0/0 badge.
- Failure containment: a failed readiness query renders the plan row without the counter (plus the standard destructive-muted inline note) — it must NOT blank the whole panel (each readiness fetch is its own query, not part of the plans query).

### D2 — Plan execution progress on plan detail (phase-grouped children + rollup)

All-frontend (data already on the wire per §0).

- In `DocDetail`, when `doc.type === "plan"`, replace the flat children footer section with an **Execution section** rendered between the Content tab body and the RELATED panel:
  - **Rollup header**: `X / Y tasks done` where done = task child with `status === "archived"` (SPEC-025 semantics: archived = 完成), Y = task children count. Plus `R ready` sourced from `apiGetReady` (D1). A plan with zero task children renders the plain children list unchanged (no empty rollup shell).
  - **Phase grouping**: group task children by `ReadyRecord.phase` (server-computed from `extra.phase`); group order follows `doc.extra.phases[]` declaration order; tasks with no phase go under `Unphased` (rendered only when non-empty); non-task children (e.g. knowledge docs parented under the plan) go under `Other documents`, title-only as today.
  - **Task rows** reuse the SPEC-036 renderers — NOT a third implementation: left `TYPE_ACCENT` border, `StatusPill`-style status badge (read-only here), `formatTypeMetaLabel(child.meta)` meta text, and a blocked indicator `blocked by <slug>` (from `unmet_blockers`, first blocker + `+n`) when `ready === false` for a non-terminal task. Row click navigates (existing `onNavigate`).
  - Join rule: readiness is indexed by `ReadyRecord.task.id` and joined to `navigation.children` client-side; a child without a matching record (race: task created after readiness fetch) renders without readiness adornments — never throws.
- The generic (non-plan) children footer stays as-is for other types in this spec (richer cards for all types = out of scope).

### D3 — Evidence trail viewer + claim detail on task detail

All-frontend (raw `DocRecord.extra` is already delivered to the detail view; parse with the existing zod schemas from `@lore/core` — browser-safe).

- In `DocDetail`, when `doc.type === "task"`, insert an **Execution section** (above PARENT/RELATED) with:
  - **Claim card** (when `extra.claim` present): holder, branch (mono), claimed-at relative time. Staleness is NOT computed client-side (no TTL in the browser — SPEC-036 precedent); the `(stale)` marker appears only in list surfaces that get it from `meta`/`ReadyRecord`.
  - **Evidence timeline** (when `extra.verification_evidence` non-empty): newest-first list; each entry = oracle badge + `result` badge (`pass` → existing secondary variant; `fail` → **destructive variant** — this is the danger-color fix, applied here AND in the task meta badge on DocCard/DocDetail header when `evidence_fail > 0`) + `command` in mono + relative `recorded_at` + `recorded_by`. `output_tail` renders collapsed behind a per-entry disclosure (`<details>`-style, shadcn collapsible or native), `<pre>` with `overflow-x-auto`, never truncated further (backend already caps at 4000 chars).
  - Malformed/legacy `extra` degrades by omission (zod `safeParse`; on failure render nothing for that block) — never a crash, never fabricated fields.

### D4 — Tree: split toggle from navigation

- `DocTree` node row becomes two interactive elements: the **chevron is its own `<button aria-label="Expand/Collapse">`** whose click/keyboard ONLY toggles (stopPropagation); the **title area navigates** (`onSelect`). Leaf nodes keep the single navigate action.
- Keyboard: chevron button is tabbable and toggles on Enter/Space; the row title remains reachable and navigates on Enter/Space. `aria-expanded` moves to the chevron button.
- Expansion default stays `depth < 2`; expansion state stays local component state. URL-persisted expansion is explicitly out of scope (low value at team-scale corpus depth ≤5).

### D5 — Search: real highlight + typed result cards

**Backend** (store-shared, all three stores' search paths):

- Change the FTS5 snippet delimiters from `'['`/`']'` to sentinels that cannot occur in authored markdown: `"\u0001"` open, `"\u0002"` close (C0 control chars, stripped from authored content by definition) (ellipsis stays `'...'`). Literal `[`/`]` in documents then can no longer collide with highlight markers. `InMemoryStore`'s search fake must emit the same sentinels (it is the vitest test double for this contract).
- `SearchHit` gains `type: DocType` and `status: DocStatus` (both already selected/selectable on the FTS join row — zero extra query).

**Frontend**:

- `SearchResultCard` splits the snippet on the sentinel pair and renders matches as `<mark>` (theme-aware styling via existing tokens; no `dangerouslySetInnerHTML`).
- Result cards add the standard type + status badges (same `Badge` usage as `DocCard`) so search results stop being the only badge-less card surface.

### D6 — Copy de-jargon (bounded to strings; no behavior change)

| Current | New |
|---|---|
| `"not ready-aware"` badge + tooltip (ActivePlansPanel) | removed entirely (D1 supersedes) |
| `"Adjudicate"` button (TriageQueue) | `"Review"` (collapsed) / `"Cancel"` (open) — unchanged when open |
| `"Optional calibration note..."` placeholder | `"Why approve/reject? (optional — helps calibrate the AI reviewer)"` |
| Raw `parent_id is required for type 'spec'` in NewDocModal | Client-side message map: `"Choose a parent document — every <type> lives under one."` Core `schemas.ts` message unchanged (shared with CLI/MCP contract tests). |

## 2. Contracts (TS, exact)

```ts
// http adapter — new route (envelope per middleware.ts)
// GET /api/ready/:planIdOrSlug  → 200 {ok:true, data: ReadyRecord[]}
//                               → 404 {ok:false, error:{code:"NOT_FOUND"}}       (unknown plan)
//                               → 422 {ok:false, error:{code:"VALIDATION_ERROR"}} (target not a plan)
//                               → 401 unauthenticated (central middleware, unchanged)

// dashboard/src/lib/api.ts — mirrors core/task-workflow.ts:104-126 exactly
export interface ReadyRecord {
  task: DocSummary;                       // narrow projection — NO meta (server contract)
  phase?: string;
  ready: boolean;
  unmet_blockers: Array<{ id: string; slug: string; status: DocStatus }>;
  claim?: { by: string; at: string; branch?: string; stale: boolean; age_minutes: number };
  latest_evidence?: { result: "pass" | "fail"; recorded_at: string };
  evidence_count: number;
  upstream_unapproved?: boolean;
}
export function apiGetReady(planIdOrSlug: string): Promise<Result<ReadyRecord[], ApiError>>;

// @lore/core — store contract change (all stores + FTS test double)
export interface SearchHit {
  id: DocId; slug: Slug; title: string; snippet: string; score: number;
  type: DocType;    // NEW
  status: DocStatus; // NEW
}
export const SNIPPET_MARK_OPEN = "\u0001";   // NEW — single source for stores + dashboard
export const SNIPPET_MARK_CLOSE = "\u0002";  // NEW
```

## 3. Acceptance criteria

- AC-37-1 `GET /api/ready/<plan>` returns the same records as `lore ready --json` for the same corpus state (parity test); non-plan id → 422; unknown id → 404; unauthenticated → 401.
- AC-37-2 ActivePlansPanel renders `N ready / M tasks` per active plan; the "not ready-aware" badge is gone; a failed readiness fetch degrades to a row without the counter, panel intact.
- AC-37-3 Plan detail groups task children under declared phase headers in declaration order, with `Unphased` and `Other documents` groups only when non-empty; rollup shows `X/Y tasks done` counting archived tasks; blocked non-terminal tasks show their first unmet blocker.
- AC-37-4 Task rows on plan detail render accent border + status + `formatTypeMetaLabel` output identical to the same doc's library card (shared-renderer parity, extends AC-36-8).
- AC-37-5 Task detail shows claim holder/branch and a newest-first evidence timeline; a fail entry renders a destructive-variant badge and its `output_tail` behind a disclosure; a legacy task with malformed extra renders no Execution section and no error.
- AC-37-6 Evidence-fail meta badges (`✘n` with n>0) render destructive-variant on DocCard, DocDetail header, and plan-detail task rows.
- AC-37-7 In the tree, clicking a collapsed node's chevron expands it WITHOUT navigation; clicking the title navigates; both work via keyboard; `aria-expanded` sits on the chevron button.
- AC-37-8 Searching a term shows `<mark>`-highlighted matches (no literal `[`/`]`), and a document whose body contains literal brackets shows them un-highlighted; result cards carry type + status badges.
- AC-37-9 All D6 strings replaced; `bun run test` + `bunx vitest run` + dashboard component tests green; NewDocModal shows the human message while CLI output for the same error is unchanged.

## 4. Out of scope (deliberate — later tiers of the product-lens plan)

- Review workbench (inline doc body/diff in /pending, judgment panel, blocking-questions answer surface) — Tier 2.
- SPEC-026 assessment rendering + timeline; calibration drill-down; structured calibration capture — Tier 3.
- Parent picker in NewDocModal, backlinks panel, Cmd+K, activity feed — Tier 4.
- Richer children cards for non-plan parents; URL-persisted tree expansion; stale-draft discard notice; conflict-modal copy.

## 5. Gates checklist (design skill)

- [x] Upstream constraint extracted: PRD-001 §13.5/§14; SPEC-025/023 data contracts; SPEC-033/036 surface conventions.
- [x] Existing-design check: no prior spec covers execution-tracking UI; SPEC-036 is the format/precedent anchor (spec→implement, no new style direction).
- [x] Benchmark study: product-lens competitive dimension (Linear progress rollup, Langfuse trace payload drill-down, GitHub checks-inline) — patterns mapped to existing Lore data, not copied wholesale.
- [x] Existing-system analysis: §0 facts table, verified in code 2026-07-07.
- [x] Module gates: no circular deps (dashboard consumes @lore/core + HTTP only); single responsibility per deliverable; public contracts in §2 sufficient for black-box tests; DI unchanged.
- [x] Cross-cutting — security: new route is read-only behind existing central auth; no new input reaches SQL (planIdOrSlug goes through existing `resolveDoc`). Performance: readiness = existing batched service call; per-plan query cached by TanStack. Observability: existing telemetry on CorpusService unaffected. Privacy: no new PII.
