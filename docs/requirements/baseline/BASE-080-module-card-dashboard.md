---
id: BASE-080
type: baseline
role: intent
title: "Module card: dashboard"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-079
links:
  - {id: SPEC-100, type: supersedes}
  - {id: SPEC-101, type: supersedes}
  - {id: SPEC-014, type: supersedes}
  - {id: SPEC-031, type: supersedes}
  - {id: SPEC-036, type: supersedes}
---
# Module card: dashboard (`@lore/dashboard`)

Source: `packages/dashboard/CLAUDE.md`. Product narratives carried here (both overviews are superseded by this card): `spec-domain-overview-dashboard-console-admin-console-evolution-adjudication-workbench-first` and `spec-domain-overview-dashboard-multi-project-single-instance-switcher-over-the-machine-s-registered-corpora`. Staged, uncommitted candidates are on the target-state section.

- **Responsibility**: web UI over the corpus — search/tree/detail/library reads, cookie-gated writes (create, edit, transitions, links, history/restore, delete), adjudication workbench, execution read surface. Vite + React 19 + Tailwind v4 + shadcn/ui, TanStack Router/Query.
- **Public surface**: the SPA; served by the http adapter from the binary (`lore dashboard`) or by Vite under `--dev`.
- **Dependencies**: `@lore/core` only (never `@lore/lore`, never `@lore/core/node`); talks to the http adapter over `/api/*`.
- **Invariants**:
  - Writes only via `/api/dashboard/*` (`src/api/mutations.ts`); PATCH sends `If-Match`, 409 opens a conflict modal.
  - No server-side modules in `src/` (`bun:sqlite`, `child_process`, `node:fs`).
  - Lifecycle choices come from `getAllowedTransitions()`; coverage/attestation math comes from `@lore/core`, never re-derived.
  - All client state is server state (TanStack Query) or URL state.
  - E2E runs on throwaway corpora and refuses a server it did not start.

## Console positioning and landed surfaces

- **Positioning**: a general admin console over the corpus (owner decision, 2026-07-24) whose primary human job is adjudication and supervision (re-anchored 2026-07-28). It serves all human collaborators; every surface is cookie-session-scoped with actor attribution through the audit trail, with no owner-only affordances.
- **Why breadth is safe**: `GateEnforcer` runs at the service layer, so every dashboard write passes the same deterministic gates as CLI and MCP. A console surface cannot bypass a gate; the residual risk is affordance design.
- **Adjudication workbench (landed)**: an evidence/AC tab on doc detail (task evidence timeline with attested-versus-self-reported label; spec AC list with per-AC coverage state; plan attestation ratio); approve/reject controls beside that evidence on any doc with a pending review; keyboard triage (`j`/`k` select, `a` approve, `x` reject with reason, `e` expand blocking questions, `o` open doc, suppressed while an editable element has focus); a judgment drill-down on `JudgmentBadge` (decision, confidence, per-dimension `reasons[]`, blocking questions, prompt version). No numeric per-dimension scores exist and none are shown. A doc with no judgment record or no evidence renders an explicit empty state, never blank and never an error.
- **Usage telemetry (landed)**: route-level view events go to the existing local JSONL sink under the existing opt-in config, through one cookie-gated ingestion route in the `/api/dashboard/*` family (the browser has no fs access). A sink write failure is logged server-side and never surfaces to the UI — a deliberate exception to fail-loud, because observability must not break the observed surface. No remote export; no doc content captured.
- **Execution read surface (landed, demoted)**: `GET /api/ready/:plan` and read-only views for claims with TTL, derived sessions, anchor conflicts, evidence timelines and phase progress. Corpus granularity is the accepted monitoring boundary; execution verbs stay CLI-only, and live agent activity belongs to the agent runner's own surfaces. Read views (search, tree, library) serve as adjudication context; AI proxying is the primary human query channel.
- **Polling, not push**: no SSE or live push; the dashboard polls.

## Packaged serving (landed)

`lore dashboard` serves the built SPA from `lore serve` in one local-only process; `--dev` keeps the two-process Vite topology for dashboard development. As built: authentication bootstraps through a one-time nonce redirect, so the machine key is never served over HTTP (loopback plus Origin alone was judged insufficient on a multi-user machine); assets are embedded in the compiled binary, so binary-versus-asset skew cannot occur; the SPA catch-all must not shadow `/api/*`. A phase that ships an auth path needs an end-to-end reachability check in its exit gate (redeem a session, then make one authenticated `/api` read); the single-process static e2e harness (`global-setup-static.ts`) exists for this because the two-process global setup cannot exercise the packaged path.

## Multi-project mount

- **Registry**: machine-scope config `dashboard.projects: [{name, path}]` (name unique, duplicates rejected at config validation; path is a repo root carrying `.lore/`). A non-empty registry means multi-project mode; absent or empty keeps single-project behaviour. Discovery is explicit registration only, with no auto-scan. `dashboard.projects` and `feedback.upstream` stay separate registries.
- **Mount states** (`MOUNT_STATES` in `@lore/core` config): `mounted`; `missing` (path absent or no `.lore/`); `schema-skew` (corpus schema version differs from the serving binary's, diagnosed by a read-only probe — mounting never auto-migrates a registered corpus); `error` (the mount attempt threw). A problem entry is never dropped: it renders in the switcher as an explicit error entry with its diagnosis, and mountable projects serve normally. After an upgrade every not-yet-migrated corpus is schema-skew at once; repair stays per-project and deliberate.
- **Addressing invariant**: every API request names its target project in the URL (`/p/:name`); an unregistered name is rejected with a 404-class response; the server keeps no session-sticky current project. `GET /api/projects` returns one entry per registry item plus the serving instance identity. The client routes all fetches and query keys through one project-scoped factory so no data from one project renders under another's URL.
- **Writes follow the switch**: adjudication, doc editing, issue triage and corpus-scope config editing run through the selected corpus's own service layer, with the same gates, `http_cookie` attribution and `If-Match` semantics. Each corpus is an independent `App` instance. The selected project's identity renders next to every write control. Machine-scope config editing stays global.
- **Auth**: one local bootstrap login covers every registered project (cookie auth is machine-scope, `dashboard-auth.db` in the XDG state dir); the server binds 127.0.0.1 only. Accepted blast radius on a single-user machine: a held session cookie exposes every registered corpus. The script-facing guard is the e2e refusal to write through a server it did not start (`assertServerIsOurs`).
- **Boundaries**: same machine, same user, several local corpora. No hosted or multi-tenant serving, no cross-project search or cross-project doc links, no per-project auth separation. Two instances may mount one corpus (SQLite WAL tolerates it); the UI shows the serving instance's identity.
- **Oracles**: `tests/e2e/multi-project-isolation.spec.ts`, `multi-project-write-parity.spec.ts` and `multi-project-cache.spec.ts` run on two throwaway corpora (a write in A leaves B unchanged; no stale data from A under B's URL).
