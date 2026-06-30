---
id: SPEC-022
type: spec
role: spec
title: "Dashboard write UI (create / edit / approve / link)"
status: draft
priority: medium
phase: P10
created: 2026-06-30
updated: 2026-06-30
tags: [dashboard, ui, write, mutation, phase-10, stub]
parent: PRD-001
links:
  - {id: SPEC-015, type: extends, note: "Adds write capabilities on top of read-only Dashboard skeleton"}
  - {id: SPEC-016, type: informs, note: "Cookie session is the auth foundation for writes"}
  - {id: SPEC-010, type: relates-to, note: "Bearer-token HTTP path is the second surface for writes; SPEC-022 covers cookie path"}
  - {id: SPEC-011, type: informs, note: "Allocates /api/dashboard/* namespace alongside existing /api/v1/* routes"}
  - {id: SPEC-021, type: relates-to, note: "Dashboard writes need export-docs to land in git"}
---

# SPEC-022: Dashboard write UI

> **Status: stub.** SPEC-015 ships v1 as read-only. SPEC-016 paves the auth foundation. This SPEC turns the dashboard into a write surface.

## 1. Purpose

The dashboard today (SPEC-015) renders list / search / tree / detail in read-only mode. Specs / PRDs / ADRs are still authored exclusively via CLI or by editing `docs/requirements/**.md` files and running `lore sync-docs`. Two costs follow:

- **Non-engineers in the team** (PM, design partners) cannot contribute to the corpus — they don't have CLI workflow muscle memory.
- **Quick edits** (typo fix on an approved spec, status change from draft → approved on a small PR-attached spec) require dropping to terminal even when the user is in-browser already.

SPEC-022 turns the dashboard from read-only to read-write: create, edit content, change status, manage links. Optimistic-concurrency-safe, lifecycle-aware, audit-trail-preserving.

## 2. Goals & Non-Goals

### 2.1 Goals

- New routes on the dashboard:
  - `POST /api/dashboard/docs` — create
  - `PATCH /api/dashboard/docs/:id` — edit content/title/priority/tags
  - `POST /api/dashboard/docs/:id/approve` — lifecycle transition (calls `ReviewService.approve`)
  - `POST /api/dashboard/docs/:id/reject` — lifecycle transition with reason
  - `POST /api/dashboard/docs/:id/links` — add link
  - `DELETE /api/dashboard/docs/:id/links/:link_id` — remove link
- UI affordances on existing pages:
  - "Edit" button on detail page → in-place markdown editor
  - "New doc" button on list page → modal with type / title / parent fields
  - Status pill on detail page is interactive → opens transition dropdown showing only valid transitions per `getAllowedTransitions(currentStatus)`
  - Links panel becomes editable
- All writes go through `CorpusService` / `ReviewService` (no new mutation paths).
- Cookie session (SPEC-016) is mandatory for write endpoints; bearer-token-issued sessions are read-only (separate concern).
- Optimistic concurrency: editing surfaces `version` to the browser; PATCH includes `If-Match` header; stale version → 409 with a friendly diff UI.
- Six-dimension test coverage including end-to-end browser tests via Playwright (already in dashboard package per SPEC-015).

### 2.2 Non-Goals

- ❌ **Real-time multi-user collaboration** (Y.js, OT, CRDT). Optimistic concurrency + last-writer-wins by version is the model.
- ❌ **Rich-text WYSIWYG** — markdown editor (textarea + preview) only. CodeMirror or simple textarea — open question.
- ❌ **AI features in dashboard** — SPEC-019's AI extensions cover CLI; future SPEC-022.1 brings them to dashboard.
- ❌ **Link-graph visual editor** — text-list editing in v1; graph-canvas comes later.
- ❌ **Token-based write API** — bearer token is HTTP-only (SPEC-010); SPEC-022 is cookie-only.
- ❌ **Bulk operations** (multi-select, mass-approve). One doc at a time.
- ❌ **Permissions per role** — every authenticated user has full write. RBAC is SPEC-022.2.

## 3. Open Design Questions

### Q1 — Editor: textarea, CodeMirror, or MDX-aware?

- **textarea**: zero dependencies, weak UX for long docs.
- **CodeMirror 6**: markdown highlight + line numbers, ~80KB gzip, well-supported in Vite.
- **MDX-aware** (live render of MDX placeholders): heavy, needs SSR of placeholders during edit.

**Recommendation**: CodeMirror 6 with markdown mode + live preview panel (split view). Skip MDX rendering in editor; show raw component tags. Render-time resolution is read-only path (existing `OutlineService`).

### Q2 — Concurrency UX

When PATCH returns 409 stale-version, what does the user see?

- Diff view: current saved version vs the user's draft, with "force overwrite" button
- Toast + reload: discard local changes
- 3-way merge interface (overkill?)

**Recommendation**: diff view + force overwrite. Avoids the worst UX (silent reload) and the gold-plating (3-way merge).

### Q3 — Status transition affordance

Status pill click opens a dropdown showing only valid transitions. But "approve" requires reviewer identity — does the cookie session imply the reviewer?

**Recommendation**: yes. Session user becomes the reviewer in `ReviewService.approve({reviewer: session.user_email})`. SPEC-016 already stores email in session.

### Q4 — Link editing UX

- Inline panel with autocomplete: type "spec" or doc title → search corpus → click to add
- Drag-and-drop from list page
- Separate `/docs/:id/links` page

**Recommendation**: inline panel with corpus search autocomplete. Reuses existing search API.

### Q5 — Server-side validation surface

Two layers exist: HTTP route handler (Zod) + CorpusService (Result<T, LoreError>). Should client-side also validate before submit?

**Recommendation**: yes — share Zod schemas from `@lore/core` for client preview. Avoids round-trip for trivial errors. Server is still the SSOT.

### Q6 — Audit trail visibility

CLI shows `lore log <id>`. Dashboard should show version timeline too. Is this scope here or SPEC-022.3?

**Recommendation**: yes, in this SPEC. Detail page gets a "History" tab listing versions (id, action, author, timestamp) with diff link.

## 4. Acceptance Criteria (early draft)

**AC-DASH-WRITE-1** Unauthenticated POST/PATCH/DELETE to write endpoints returns 401.

**AC-DASH-WRITE-2** Authenticated `POST /api/dashboard/docs` with valid payload creates a doc via `CorpusService.create`, returns 201 with the new doc envelope.

**AC-DASH-WRITE-3** `PATCH /api/dashboard/docs/:id` with `If-Match: <stale_version>` returns 409 with current version + diff payload.

**AC-DASH-WRITE-4** Status transition dropdown only renders valid transitions (`getAllowedTransitions` SSOT).

**AC-DASH-WRITE-5** Editing `content` on an `approved` doc returns 200 + status auto-flipped to `draft`; response surfaces the status change to client.

> **Note on lifecycle SSOT**: `VALID_TRANSITIONS` (`schemas.ts:196-203`) has no `approved → draft` edge. This auto-reset is the same service-layer bypass already in use by `CorpusService.update` per CLAUDE.md ("Editing content/title on an approved doc resets it to draft automatically"). Dashboard write handlers MUST NOT route this via `isValidTransition()`; the demotion happens inside `CorpusService.update` as a content-edit side effect. Same convention applies to SPEC-019 AC-SET-AI-4.

**AC-DASH-WRITE-6** Adding a link to a doc rejects cycles (`CorpusService.link` returns CYCLE_ERROR → 422 with explanation).

**AC-DASH-WRITE-7** Successful approve emits version with reviewer = `session.user_email`.

**AC-DASH-WRITE-8** Detail page History tab shows version timeline; diff link opens unified-diff view between versions.

**AC-DASH-WRITE-9** Bearer-token-issued sessions (SPEC-010 path) cannot reach write endpoints — 403.

**AC-DASH-WRITE-10** Client-side Zod validation rejects empty title before HTTP submit.

**AC-DASH-WRITE-TEL-1** Telemetry emits one `doc.created` / `doc.updated` / `doc.approved` event per write, with `source: "dashboard"` discriminator (vs `source: "cli"`).

## 5. Out-of-scope rejections

- "AI-assisted refine button in dashboard" — covered by future SPEC after SPEC-019 lands and matures.
- "RBAC / per-role permissions" — SPEC-022.2, not v1.
- "Soft-delete restore UI" — `lore restore` covers it CLI-side; dashboard remains create/edit only for v1.
- "Multi-doc clone / template" — future SPEC.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Cookie session lacks CSRF protection by default | SPEC-016 already includes CSRF token in form posts; SPEC-022 reuses that pattern unchanged. |
| Markdown editor saves trigger huge version churn | Debounce save (1s) + explicit "Save" button; no auto-save on keystroke. |
| 409 conflict diff renders huge unhelpful diffs for whitespace changes | Use diff_words / diff_chars per SPEC-018 follow-up; same library, same UX. |
| User edits then refreshes losing draft | LocalStorage draft cache with `{doc_id, version, content, last_edited_at}`; restored on detail page mount. |
| Server-driven Zod schemas diverge from client copy | Re-export from `@lore/core` via Vite import; single source. |
| Concurrent edit storm (5 users editing same approved doc) | Optimistic concurrency funnels them; second-writer sees 409 + diff. Document this as the intended behaviour, not a bug. |

## 7. Outstanding Decisions (block implementation)

- Q1-Q6 above each need a final answer.
- Editor library choice (Q1) should be benchmarked: CodeMirror 6 vs Lexical vs textarea + simple syntax-hint plugin.
- Concurrency UX (Q2) needs a user test before locking in.
