---
id: KN-060
type: knowledge
role: knowledge
title: "Dogfood — dashboard UI/UX review 2026-07-26 (10 findings, fix batch + 4 deferred decisions)"
status: draft
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: [dashboard, uiux, dogfood]
parent: PRD-001
---
# Dogfood Report: Lore Dashboard (UI/UX review)

| Field | Value |
|-------|-------|
| **Date** | 2026-07-26 |
| **App URL** | http://localhost:5173 (throwaway corpus, seeded) |
| **Session** | lore-dash |
| **Scope** | Full dashboard, UI/UX focus (visual, UX, content, a11y, console) |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 3 |
| Medium | 5 |
| Low | 2 |
| **Total** | **10** |

**Passed destructive probes** (for the record): markdown/HTML XSS fully escaped in editor preview + rendered content (`document.title` unchanged); hostile FTS5 operators (`"AND NOT (*:`) degrade to a graceful 0-result page; double-click Save produces exactly one version (editor exits edit mode on first click); 404 doc page is graceful with a way back; Evidence tab, History/Audit tabs, AdjudicationBar, breadcrumbs, library URL-state filters all behave correctly.

**Triage** — fix now (pure frontend, unambiguous bugs): ISSUE-001, 002, 003, 005, 009, 010, plus the honest-copy half of 007. Needs product/spec decision (semantics or API surface): ISSUE-004 (parent picker design), 006 (write-attribution identity model), 007 full fix (phase-status projecting declared phases — SPEC-077/056 pinned semantics), 008 (queue inclusion semantics for in-review docs).

## Issues

### ISSUE-001: Pending Review panel — badges overlap each other and crush titles to 2-6 chars

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | visual / ux |
| **URL** | http://localhost:5173/ |
| **Repro Video** | N/A (visible on load) |

**Description**

In the home page "Pending Review" side panel, each row renders `[type badge] [meta badge] [title] [judgment badge]` on one line with no flex-shrink discipline:

- Row 1 (claimed task): the `claimed:agent:worker-ss…` meta badge and the right-aligned `unreviewed` badge **overlap — their texts render on top of each other** ("…worker-ssunreviewed").
- All rows: the title — the primary identifier — is truncated to near-uselessness (`Retr…`, `SSE ov…`, `T2 Even…`) while secondary metadata badges keep full width. Information priority is inverted: a reviewer cannot tell which doc a row refers to without clicking.

Expected: title gets layout priority (min readable width), badges truncate/shrink or wrap; no two elements may overlap at any width.

![Pending Review overlap](screenshots/issue-001-pending-overlap.png)

---

### ISSUE-002: Library filter chips are keyboard/screen-reader inaccessible (plain divs)

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | accessibility |
| **URL** | http://localhost:5173/library |
| **Repro Video** | N/A (structural, verified via a11y tree + DOM probe) |

**Description**

The type-filter and status-filter chip rows (`All / prd / spec / … / phase` and `All / draft / … / deprecated`) are rendered as `<div>` elements with `onClick` only — a11y tree reports them as `generic clickable`; DOM probe confirms `tabindex=null`, `role=null`. They cannot be reached with Tab, activated with Enter/Space, or announced as toggles by a screen reader. Mouse-only functionality. Also there is no visible group label distinguishing the two rows (both start with an "All" chip).

Expected: chips are `<button aria-pressed>` (or radio group), focus-visible ring, and each row has a label ("Type", "Status").

![Filter chips](screenshots/issue-002-chips-not-focusable.png)

---

### ISSUE-003: New-doc modal defaults to `spec` — the one type that cannot be created here

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | ux |
| **URL** | http://localhost:5173/library (New doc modal) |
| **Repro Video** | N/A (visible on open) |

**Description**

Opening "New doc" pre-selects Type = `spec`, which is deliberately blocked at create time (ADR: CLI/skill-only spec authoring). The user's very first sight of the form is a warning notice plus a disabled Create button — a dead-end default. Any other type (e.g. `knowledge`) would open in a usable state.

Expected: default to a creatable type (e.g. `knowledge` or `task`); keep `spec` selectable to show the guidance notice when explicitly chosen.

![New doc modal default](screenshots/newdoc-modal.png)

---

### ISSUE-004: Parent ID is a bare text field requiring a hand-typed ULID/slug

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | ux |
| **URL** | http://localhost:5173/library (New doc modal) |
| **Repro Video** | N/A |

**Description**

For parent-requiring types the modal asks for "ULID or slug of parent doc" in a free-text input with no picker, no autocomplete, no validation-on-blur. A human user must leave the modal (losing nothing, but breaking flow), find a doc, copy its slug, and return. First submit is the first moment a typo is discovered.

Expected: a searchable select fed by the already-cached doc list (title + slug), still allowing raw paste.

![Parent ID field](screenshots/newdoc-modal.png)

---

### ISSUE-005: Header "N docs" counter goes stale after creating a doc

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | functional |
| **URL** | http://localhost:5173/docs/01KYEDE0Q4SW7BMM9ZF3RW54A6 |
| **Repro Video** | N/A (probed via DOM text before/after reload) |

**Description**

After creating a knowledge doc through the New-doc modal (create succeeded, toast shown, navigated to the new doc), the header still reads "9 docs". A full page reload corrects it to "10 docs". The create mutation does not invalidate the status/count query.

**Repro Steps**

1. Library → New doc → type `knowledge`, any title → Create. Toast confirms, navigation to `/docs/<id>` happens.
2. **Observe:** header pill still says "9 docs" (probed `document.body.innerText` → `"9 docs"`); after `location.reload()` it says "10 docs".

---

### ISSUE-006: UI-created docs get `Author: system` instead of the acting identity

| Field | Value |
|-------|-------|
| **Severity** | low |
| **Category** | content / functional |
| **URL** | http://localhost:5173/docs/01KYEDE0Q4SW7BMM9ZF3RW54A6 |
| **Repro Video** | N/A |

**Description**

A doc created through the dashboard shows `Author: system` in the metadata table. The dashboard session has an identity (cookie session bootstrapped from the machine `dashboard-local` key); attributing UI writes to "system" loses provenance that the audit trail elsewhere works hard to keep.

![Author system](screenshots/newdoc-after-create.png)

---

### ISSUE-007: Execution page claims "This plan has no phases yet." for a plan with 2 declared phases

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | functional / ux |
| **URL** | http://localhost:5173/execution?plan=plan-implementation-task-board-realtime-sync |
| **Repro Video** | N/A (state contradiction, verified via API + CLI) |

**Description**

The seeded plan declares two phases via `lore phase add` (`extra.phases: ["Phase 1 — SSE channel", "Phase 2 — Client reconnect"]`) and all three tasks carry `extra.phase`. CLI `lore phase list` shows both. Yet the Execution page's Phase Progress panel renders the empty state "This plan has no phases yet."

Root cause (verified): `GET /api/phase-status/:plan` returns `phases: []` because `PhaseWorkflowService.planPhaseStatus` only counts SPEC-056 phase **documents** (migration-created only) — not the far more common `extra.phases` declaration path. For every normally-authored plan the panel is permanently, misleadingly empty, contradicting the Tree page (which groups tasks by these same phases) and the CLI.

Expected: the panel projects declared phases too (grouping tasks by `extra.phase` with evidence/AC rollups), or at minimum the empty-state copy distinguishes "no phase docs (migration-only feature)" from "no phases".

![Execution empty phases](screenshots/execution.png)

---

### ISSUE-008: In-review docs appear in NO queue — Pending Review panel and Triage Queue only list drafts

| Field | Value |
|-------|-------|
| **Severity** | medium |
| **Category** | ux |
| **URL** | http://localhost:5173/ and /pending |
| **Repro Video** | N/A |

**Description**

The seeded `in-review` knowledge doc renders an AdjudicationBar on its detail page (it is literally awaiting approve/reject), yet it is absent from both the home "Pending Review" panel and the `/pending` Triage Queue — both surfaces list only `draft` docs (CLI `lore pending` semantics). The only discovery path for a doc that most needs adjudication is manually filtering Library by status `in-review`. A reviewer working from the queues will never see it.

Expected: queues include `in-review` docs (arguably ahead of drafts), or a separate clearly-labeled section for them.

![Triage queue without in-review doc](screenshots/pending-queue.png)

---

### ISSUE-009: Light theme — all markdown body text is near-invisible (≈1.4:1 contrast)

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | visual / accessibility |
| **URL** | http://localhost:5173/ (and every doc detail page) |
| **Repro Video** | N/A (visible on load; computed-style probed) |

**Description**

In light theme, every rendered-markdown paragraph (home PRD body, doc-detail content) renders at `color: oklch(0.872 0.01 258.338)` — an 87%-lightness grey on a pure-white body (`rgb(255,255,255)`). Measured contrast ≈ 1.4:1 vs the WCAG AA minimum 4.5:1. The dark-theme prose foreground is leaking into light mode; headings are unaffected. Verified identical on home and `/docs/knowledge-retro-resume-token-replay-gap`.

![Light mode unreadable prose](screenshots/home-light.png)

---

### ISSUE-010: 375px viewport — home page overflows horizontally; top nav truncated with no fallback

| Field | Value |
|-------|-------|
| **Severity** | high |
| **Category** | visual / responsive |
| **URL** | http://localhost:5173/ |
| **Repro Video** | N/A |

**Description**

At a 375×812 viewport the home page's two-column grid does not collapse: the body itself scrolls horizontally, paragraph text is cut at the viewport edge, and the entire side-panel column (Pending Review / Active Plans / Feedback Loop) sits off-screen. The top nav also overflows ("Issues" clipped to "Is…") with no hamburger/wrap. Library (`/library`) collapses to one column correctly — the regression is specific to the home grid and nav. 

Expected: single-column stack below a breakpoint; nav wraps or collapses.

![Mobile home overflow](screenshots/home-mobile.png)

---

## Deferred items needing product/spec decisions (not fixed in the fix batch)

- **ISSUE-004** NewDocModal parent picker: replace free-text ULID/slug field with searchable select fed from cached doc list. Needs small UX design pass.
- **ISSUE-006** UI-created docs get `Author: system`: decide the attribution model for cookie-session writes (e.g. carry the dashboard session identity into CorpusService author).
- **ISSUE-007 full fix** `/api/phase-status` only projects SPEC-056 phase DOCS; plans with `extra.phases` declarations show an empty Phase Progress panel. Full fix = service-level projection of declared phases (SPEC-077 S3 / SPEC-056 semantics change → needs spec update via /lore-design). Interim: honest empty-state copy shipped in fix batch.
- **ISSUE-008** in-review docs appear in NO queue (home Pending Review + /pending both list drafts only, per CLI `lore pending` semantics). Decide queue inclusion semantics; an in-review doc with an AdjudicationBar currently has no discovery path except Library status filter.

Fix batch tracked as lore task: task-dashboard-ui-ux-dogfood-fix-batch-light-prose-contrast
Screenshots archived in the dogfood session scratchpad (ephemeral); report text here is the durable record.
