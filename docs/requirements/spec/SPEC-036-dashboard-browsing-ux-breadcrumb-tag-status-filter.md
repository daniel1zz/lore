---
id: SPEC-036
type: spec
role: spec
title: "Dashboard browsing UX: breadcrumb + tag/status filters + type-differentiated presentation"
status: approved
priority: high
created: 2026-07-07
updated: 2026-07-27
tags: [spec-036, dashboard, ux, feedback-loop]
parent: PRD-001
---
# SPEC-036 — Dashboard browsing UX: breadcrumb + tag/status filters + type-differentiated presentation

> Kind: feature (+design constraints). Parent: PRD-001 §13.5 (human-friendly directive). Relates: SPEC-015 (read views), SPEC-022 (detail/write surface), SPEC-033 (living-PRD home + library relocation).
> Origin: owner feedback 2026-07-07 — detail pages have no way back up the hierarchy except browser-back; library filtering is type-only; all doc types render as one undifferentiated card ("没有重点").
> Consumer: implement (backend task + frontend task) → e2e verify in the real dashboard (owner chose spec→implement over HTML-prototype gate; visual language is fixed by the existing shadcn/Tailwind system — no new style direction is introduced).

## 0. Current-state facts (verified 2026-07-07)

| Fact | Location |
|---|---|
| `navigation.parent` (single level) already returned by `GET /api/docs/:id` | `corpus-service.ts:66-73` (`DocWithNavigation`) |
| Detail page renders Parent/Children only in a bottom footer | `DocDetail.tsx:576-608` |
| `ListFilters` already supports `type/status/parent_id/created_by/since/tags`; HTTP list route already parses `status` + `tags` (comma-split) | `packages/core` types; `http/routes.ts:233-248` |
| Tags filter semantics: **AND** (`requiredTags.every(...)`), applied in-memory after SQL | `sqlite-store.ts:201-206` (same in turso/in-memory) |
| `store.list` returns full `DocRecord[]`; `CorpusService.list` projects to `DocSummary` — tags/extra are available at projection time with zero store changes | `sqlite-store.ts:198` |
| Dashboard library page passes only `type`; filter state is `useState`, violating the module's "all client state is server state + URL state" invariant | `routes/library.tsx:42,93` |
| `DocCard` renders title + coarse type/status badge variants only (3 buckets) | `DocCard.tsx` |

## 1. Deliverables

### D1 — Ancestor chain + breadcrumb

**Backend** (`CorpusService.get` navigation assembly; adapters stay thin pipes):

- `DocWithNavigation.navigation` gains `ancestors: DocSummary[]` — the `parent_id` chain from root to direct parent, root-first, excluding the current doc. Empty array for root docs.
- Walk via `store.find(parent_id)` iteratively. Cycle guard: stop walking when an id repeats (seen-set); depth cap 20 (corpus contract depth is ≤5; the cap is a runaway backstop, not a feature). A broken parent ref (find → null) terminates the walk with the ancestors collected so far — the doc is still viewable; tree integrity reporting belongs to TreeCheckService, not `get`.
- CLI/MCP surfaces: unchanged (field rides along in `--json` output naturally; no formatter changes in this spec).

**Frontend** (`DocDetail.tsx` top, above the title):

- Breadcrumb nav: `Home / <ancestor titles…> / <current title>`. Home crumb navigates to `/` (living-PRD home); ancestor crumbs use the existing `onNavigate`; current title is plain text with `aria-current="page"`.
- `<nav aria-label="Breadcrumb">` + `/`-style separators using existing muted-foreground tokens; no new dependency (compose from existing primitives).
- Overflow: when ancestors > 3, collapse the middle to a single `…` crumb (title list in `title` attr); first (root) and last (direct parent) always visible.
- The bottom navigation footer (Parent/Children/Links) is untouched.

### D2 — Library filters: tags + status

- **Status filter**: chip row identical in interaction to the existing type chips (single-select + "all"), values from the `DocStatus` union in `@lore/core` — never hardcode the list.
- **Tag filter**: multi-select chips. Selected tags are passed as `tags` (comma-joined) to `apiList`; semantics are the store's existing AND — the UI labels the group "Tags (all of)" so the semantics are visible, not guessed.
- **Tag vocabulary source**: derived client-side from the unfiltered `apiList({})` query (distinct tags + counts, sorted by count desc). Rationale: corpus scale is team-sized (~10² docs — 138 today); the unfiltered list is already the library landing query, so the vocabulary costs zero extra requests via the TanStack cache. A dedicated `GET /api/tags` aggregate is deliberately deferred until corpus scale invalidates this (documented here as the revisit trigger, ~10⁴ docs).
- **URL state**: ALL library filters (type + status + tags) move to router search params (`/library?type=spec&status=draft&tags=a,b`) — fixes the existing `useState` violation of the dashboard invariant; filters survive reload/share/back.
- `apiList` wrapper extends its opts to `{type?, status?, tags?}`; backend untouched.

### D3 — Type-differentiated cards + detail header

**Shared projection** (`@lore/core`, browser-safe):

- `DocSummary` gains `tags: string[]` and `priority: Priority`, plus `meta?: DocTypeMeta`.
- `DocTypeMeta` = discriminated union derived by a NEW pure function `deriveTypeMeta(doc, opts?: {claimTtlMinutes?: number})` in `@lore/core` (single derivation point — CLI badge convergence is a noted follow-up, not in scope):
  - `{ t: "spec", kind: "feature"|"tech"|"design" }`
  - `{ t: "adr", decision_status: … }`
  - `{ t: "knowledge", sub_type: … }`
  - `{ t: "plan", phase_count: number }`
  - `{ t: "task", claimed_by?: string, claim_stale?: boolean, evidence_pass: number, evidence_fail: number }` — staleness computed from `extra.claim.at` + TTL only when `claimTtlMinutes` provided; omitted otherwise (never a fabricated `false`).
  - `prd` → no meta entry.
- Missing/legacy extra fields degrade by OMISSION (optional fields absent), never by throwing and never by fabricated defaults.
- `CorpusService` gains optional constructor param `claimTtlMinutes` (same DI shape as `TaskWorkflowService`/`AuditService`), wired from config in `app.ts`, used only for summary projection.

**DocCard**:

- Left accent border colored per type — 6 hues from the Tailwind palette with dark-mode variants, defined once as a `TYPE_ACCENT` map in a shared module (`src/lib/type-accent.ts`), consumed by card + detail header. Contrast: accents are non-text decoration (WCAG 1.4.11 ≥3:1 against adjacent background).
- One meta row per type from `meta`: task → claim holder + `(stale)` + `✔n/✘n` (MUST mirror the CLI badge semantics in `cli/utils.ts` — same precedence, same stale rule; don't invent a third rendering rule, cf. the `JudgmentBadge` precedent); adr → decision_status badge; spec → kind badge; knowledge → sub_type badge; plan → `N phases`.
- Tag chips (≤3 + `+n` overflow) on every card.
- Priority rendered only when `critical`/`high` (visual noise budget: default/low priority is the norm and must not shout).

**DocDetail header**: same accent + meta strip + full tag list under the title block. Body/tabs untouched.

## 2. Contracts (TS, exact)

```ts
// @lore/core — types.ts
export interface DocSummary {
  id: DocId; slug: Slug; type: DocType; title: string; status: DocStatus;
  updated_at: string;
  tags: string[];                    // NEW — always present (may be empty)
  priority: Priority;                // NEW
  meta?: DocTypeMeta;                // NEW — absent for prd / on derivation opt-out
}

export type DocTypeMeta =
  | { t: "spec"; kind: SpecKind }
  | { t: "adr"; decision_status: DecisionStatus }
  | { t: "knowledge"; sub_type: KnowledgeSubType }
  | { t: "plan"; phase_count: number }
  | { t: "task"; claimed_by?: string; claim_stale?: boolean; evidence_pass: number; evidence_fail: number };

export function deriveTypeMeta(doc: DocRecord, opts?: { claimTtlMinutes?: number }): DocTypeMeta | undefined;

// CorpusService — navigation
navigation: {
  parent: DocSummary | null;
  ancestors: DocSummary[];           // NEW — root-first, excludes current doc
  siblings: DocSummary[];
  children: DocSummary[];
  related: Array<DocSummary & { link_type: LinkType }>;
}
```

## 3. Acceptance criteria

- AC-36-1 `GET /api/docs/<task-id>` for a depth-4 doc returns `navigation.ancestors` = `[prd, spec, plan]` (root-first); root doc returns `[]`.
- AC-36-2 Ancestor walk on a corpus with a manufactured parent cycle terminates and returns the pre-cycle chain (regression test at store/service level).
- AC-36-3 Detail page renders the breadcrumb above the title; each ancestor crumb navigates; current title is not a link; footer unchanged.
- AC-36-4 Breadcrumb with >3 ancestors collapses the middle to `…` retaining root + direct parent.
- AC-36-5 `/library?status=draft` (reload) shows the status chip selected and the filtered list; combining `type`+`status`+`tags` ANDs all three; clearing a chip removes its param.
- AC-36-6 Tag chips show the distinct vocabulary from the unfiltered corpus with counts; selecting two tags returns only docs carrying BOTH (AND semantics pinned by test).
- AC-36-7 List responses carry `tags`, `priority`, and correct `meta` per type; a legacy task doc without evidence yields `evidence_pass: 0, evidence_fail: 0`, absent `claimed_by`.
- AC-36-8 Task card meta matches the CLI badge for the same doc state (claimed fresh, claimed stale, unclaimed; with/without evidence) — parity test enumerating the CLI rule table.
- AC-36-9 Type accent + meta row render for all 6 types in light AND dark mode (component test asserts accent class mapping; e2e smoke asserts visibility).
- AC-36-10 `deriveTypeMeta` never throws on arbitrary `extra` shapes (fuzz/NEGATIVE cases: null, wrong types, missing) — omission, not fabrication.

## 4. Cross-cutting

- **Security**: read-only surfaces; tag param already existed server-side; tag text rendered via React (escaped). No new auth surface.
- **Performance**: ancestor walk ≤ tree depth (≤5 typical, cap 20) point lookups per detail GET — negligible; tag vocabulary reuses the cached landing query (zero extra requests).
- **Observability**: no new events (read paths); existing telemetry on CorpusService.get/list covers volume.
- **A11y**: breadcrumb is `nav[aria-label=Breadcrumb]` + `aria-current`; filter chips keep the existing `role="group"` + pressed-state pattern; accent borders are supplementary (type name stays as text badge — color is never the only signal).

## 5. Non-goals

- Per-type bespoke detail layouts (owner chose card+header depth).
- Search/tree page filtering; CLI/MCP output changes; `GET /api/tags` endpoint (deferred with revisit trigger above).
- Reworking the bottom navigation footer.

## 6. Test contract

- Six-dimension coverage on: `deriveTypeMeta` (core), ancestors assembly (service, incl. cycle/broken-ref), `apiList` opts (dashboard lib), library URL-state, Breadcrumb, DocCard meta rows.
- Runners: core/service → vitest (InMemoryStore); dashboard → vitest jsdom component tests; e2e additions to the Playwright suite (breadcrumb navigation + filter roundtrip).

## 7. Addendum — pending-queue extension (2026-07-07)

The §2 D3 type-meta projection is extended beyond `CorpusService`/`DocSummary` to the review pending queue:

- **D3-P1** `ReviewService` gains the same optional constructor param `claimTtlMinutes` (identical DI shape as `CorpusService`; both `app.ts` assembly points — SQLite and Turso — pass the one `resolveClaimTtlMinutes(config)` value). When absent, `deriveTypeMeta` omits `task.claim_stale` entirely — never a fabricated `false`.
- **D3-P2** `PendingDoc` (returned by `ReviewService.pending`, served verbatim by `GET /api/review/pending`) gains optional `meta?: DocTypeMeta`, derived per row via the same `deriveTypeMeta` single derivation point. Docs whose type has no meta variant (prd) or whose required `extra` field is missing/malformed omit the key entirely (conditional spread; `exactOptionalPropertyTypes` semantics).
- **D3-P3** Dashboard `PendingDocRow` mirrors the field; `TriageQueue` and the home `PendingPanel` render the badge via the existing shared `formatTypeMetaLabel` + `metaBadgeVariant` pair — same composition as `DocCard`, no hand-rolled projection. A `null` label (e.g. unclaimed task with no evidence) or absent `meta` renders no badge.

Motivation: the pending queue is dominated by `knowledge` docs, where the bare type badge has zero discriminating power; `sub_type` (assessment vs ideation/research) is the primary triage signal (machine-generated vs human-authored).

**ACs**: AC-36-11 pending rows carry `meta` per type with omission (not fabrication) on prd/malformed extra; AC-36-12 `claim_stale` appears in pending task meta only when `claimTtlMinutes` is wired; AC-36-13 TriageQueue/PendingPanel render the shared badge and stay crash-free when `meta` is absent or the label is `null`. Six-dimension coverage: `packages/lore/tests/unit/service/review-service.test.ts` (meta projection block), `packages/dashboard/tests/component/{TriageQueue,PendingPanel}.test.tsx`.
