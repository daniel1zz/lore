---
id: SPEC-27
type: spec
role: spec
title: "Dashboard hardening: write-path integrity, delete/restore, component test coverage"
status: approved
priority: high
created: 2026-07-03
updated: 2026-07-27
tags: [dashboard, hardening, spec-027]
parent: PRD-001
---
# SPEC-027 — Dashboard Hardening: write-path integrity, delete/restore surface, component test coverage

> Origin: 2026-07-03 three-track dashboard assessment (business completeness / code review / test health).
> Scope agreed with owner: P1 bugfixes + P2 component tests + P3 delete/restore UI + P5 housekeeping (CLAUDE.md, DiffView, CORS).

## 1. Problem

The SPEC-022 write surface shipped with three latent defects and a structural test gap:

1. **Cross-document edit-state leak (CRITICAL)** — `routes/docs.$id.tsx:77` renders `<DocDetail>` without `key={doc.id}`; `DocDetail` keeps `isEditing`/`editContent`/`editorSeed` in local state with no reset on `doc.id` change. With a warm TanStack Query cache (5-min staleTime) navigating A→B reuses the component instance: saving writes A's buffer into B.
2. **Status transitions bypass optimistic concurrency (MAJOR)** — `DocDetail.tsx:212` `handleTransition` PATCHes `{status}` without `version`, so `checkConcurrency` waves it through (`ifMatch === null` → allow). Two tabs archiving/deprecating concurrently silently lose an update.
3. **Draft debounce timer leak (MAJOR)** — `handleSave` / Cancel clear the localStorage draft but not `draftSaveTimerRef`; a pending 1s timer resurrects an explicitly discarded draft (version unchanged → judged fresh on next open).
4. **Write-component test gap** — all six SPEC-022 write components (Editor, ConflictModal, NewDocModal, StatusPill, HistoryTab, LinksPanel) have zero component-level tests; only 6 Playwright scenarios + API-layer mocks cover them.
5. **Capability gaps with backend already present** — no dashboard UI for soft delete or version restore; cookie-authed routes for these do not exist yet (bearer-token routes do).
6. **Housekeeping debt** — duplicated unified-diff line-coloring in HistoryTab vs ConflictModal; CORS `Access-Control-Allow-Origin: *` coexists with cookie sessions (no defense-in-depth); `packages/dashboard/CLAUDE.md` describes the pre-SPEC-022 state.

## 2. Acceptance Criteria

- **AC-DH-1** `<DocDetail>` remounts or fully resets edit-session state (`isEditing`, `editContent`, `editorSeed`) when `doc.id` changes. A regression test simulating cached A→B navigation proves editor state cannot leak across documents.
- **AC-DH-2** Every status transition initiated from the dashboard (approve/reject already covered; Activate/Archive/Deprecate/Return-to-draft) sends `If-Match: <version>`. A stale transition receives 409 and enters the existing conflict-handling path. Test proves a version-mismatched transition does not silently overwrite.
- **AC-DH-3** Both Save and Cancel clear the pending draft debounce timer. Test proves a draft written ≤1s before Cancel does not resurrect after `clearDraft`.
- **AC-DH-4** A single shared `DiffView` component renders unified diffs for both HistoryTab and ConflictModal; the duplicated line-coloring logic is removed from both call sites.
- **AC-DH-5** CORS `Access-Control-Allow-Origin` echoes the request Origin only when it is in `ALLOWED_ORIGINS` (never `*` on dashboard/write surfaces). Existing HTTP adapter tests stay green; new tests cover allowed vs disallowed origins.
- **AC-DH-6** Dashboard can soft-delete a document behind an explicit confirmation dialog, via a cookie-authenticated `/api/dashboard/*` route, then navigates away from the deleted doc. Component/e2e coverage exists.
- **AC-DH-7** HistoryTab offers Restore on historical versions via a cookie-authenticated route; restore is append-only (creates a new version, consistent with `VersionService.restore`). Coverage exists.
- **AC-DH-8** Editor, ConflictModal, NewDocModal, StatusPill, HistoryTab, LinksPanel each have a component-level (jsdom + testing-library) test file passing under vitest, covering at minimum: happy render, key interaction, and one error/edge path.
- **AC-DH-9** Full oracle suite green at closeout: `bun run typecheck`, `bun run test:vitest`, `bun run test:bun`, `cd packages/dashboard && bunx playwright test`.
- **AC-DH-10** `packages/dashboard/CLAUDE.md` matches post-change reality (e2e suite exists, component inventory, delete/restore surface, test layout).

## 3. Non-goals

- SPEC-023 phases / SPEC-025 claim-evidence / SPEC-026 assessment rendering in the dashboard (separate spec).
- Session-expiry UX overhaul (401 recovery flow) — noted as follow-up.
- Any change to `@lore/core` public API. Browser-safe invariant must hold: no Node-only imports from dashboard sources.

## 4. Constraints

- Cookie auth + If-Match optimistic concurrency are the SPEC-022 contract; new write routes follow the same `assertCookieActor` + telemetry (`source: "dashboard"`) pattern in `dashboard-routes.ts`.
- Two test runners: component tests are vitest (`*.test.tsx`); nothing here may import `bun:sqlite` into vitest-reachable modules.
- All fixes preserve fail-loud error handling (no silent fallback).


## 5. Round-2 hardening ACs (from assessment KN-008 recommendations, 2026-07-03)

- **AC-DH-11** The dashboard restore route requires an explicit `confirm=true` gate (mirroring delete). Restoring a version that does not exist returns a documented, tested error contract (VALIDATION_ERROR vs NOT_FOUND explicitly chosen and asserted) — never an ambiguous 500.
- **AC-DH-12** A server-side regression test asserts that `DELETE /api/dashboard/docs/:id` WITHOUT `confirm=true` is rejected (defense-in-depth: UI confirmation dialog is not the only gate).
- **AC-DH-13** `cors.bun.test.ts` locks the disallowed-origin behavior with explicit negative assertions: response carries NO `Access-Control-Allow-Origin` header at all (not `*`, not the origin) for non-allowlisted origins, on both read and write surfaces.
