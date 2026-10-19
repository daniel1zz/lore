# Module: @lore/dashboard

Architecture card: `baseline-module-card-dashboard`

## Purpose

Vite + React + shadcn local-dev web UI: read views plus the SPEC-022 write surface. Web UI for browsing/editing the Lore corpus. Vite + React 19 + TypeScript + Tailwind v4 + shadcn/ui. Read views (search / tree / detail / library) plus a cookie-gated write surface: create, in-place markdown editing (CodeMirror 6 + split preview), status transitions, link management, version history + restore, soft delete, an adjudication workbench (evidence tab + approve/reject), and an execution read surface (`/execution`). Home (`/`) renders the resolved living PRD via `ResolvedPrdBody`'s MDX-placeholder splicing (`splitContentByPlaceholders`) — never raw tag text or `dangerouslySetInnerHTML`. Auth is cookie-only (no login UI).

**Production packaging (F5a, spec-dashboard-production-packaging-one-command-lore-dashboard)**: `lore dashboard` alone (no flags) is the default launch path — one process, the built SPA embedded into the compiled `dist/lore` binary and statically served by the lore HTTP adapter, auth via a one-time nonce redirect. NO vite process on this path. The two-process vite dev-server topology (below) is retained behind `--dev`, for dashboard SPA development only. See [`../lore/src/adapters/http/CLAUDE.md`](../lore/src/adapters/http/CLAUDE.md) for the serving/nonce mechanism — this package's `src/**` is byte-identical across both topologies (DD-2: the SPA has zero changes; `bootstrapAuthIfNeeded()` below just no-ops when there's no injected token).

## Commands

```bash
lore dashboard                                    # packaged mode (default) — one process, no vite; opens the browser at a one-time nonce URL
lore dashboard --dev                               # --dev-only: two-process vite topology (spawns both processes; see Topology below)
bun run --filter '@lore/dashboard' dev             # vite :5173 alone — pair with `bun run dev` (lore serve :8787) for the manual two-terminal form
cd packages/dashboard && bunx vitest run           # unit + component tests (jsdom)
cd packages/dashboard && bunx playwright test      # e2e against the --dev (vite) topology — real chromium + lore serve + vite dev
cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.static.config.ts   # e2e against the packaged single-process topology (`test:e2e:static` npm script; playwright.static.config.ts + global-setup-static.ts spawn the packaged serving stack against a throwaway corpus, assert NO vite process and a served build-stamp digest matching a freshly computed one)
```

## Topology

**Packaged (default, no flags)** — `scripts/build.ts`'s dashboard step embeds the built `packages/dashboard/dist/**` bundle into `dist/lore`; `lore dashboard` starts ONE process, the lore HTTP server with static serving + SPA fallback enabled, mints a one-time nonce, and opens the browser at `/auth/bootstrap?nonce=<n>`:

```
lore dashboard                Browser
──────────────                ───────
→ lore HTTP server                │
→ :8787 (static + /api/*) ◄───────┘
```

**`--dev`** retains the pre-existing two-process vite topology, for dashboard SPA development only (`lore dashboard --dev` spawns both processes for you; the manual two-terminal form below is equivalent):

```
Terminal A          Terminal B                   Browser
──────────          ──────────                   ───────
bun run dev         bun run --filter             http://localhost:5173
→ lore serve          '@lore/dashboard' dev          │
→ :8787             → vite :5173 ◄──────────────────┘
                       └── proxy /api/* ──► localhost:8787
```

Two-process model intentional for `--dev`. `vite.config.ts` sets `server.proxy: { "/api": "http://localhost:8787" }` so the browser sees one origin (no CORS).

## Key Invariants

- **Writes only via `/api/dashboard/*`.** All mutations go through cookie-gated dashboard endpoints (`src/api/mutations.ts`): create, PATCH, approve, reject, link create/delete, DELETE (`?confirm=true`), POST restore. `src/lib/api.ts` stays read-only. PATCH sends `If-Match: <version>` (incl. status transitions); 409 → ConflictModal; force overwrite = no `If-Match` + `X-Force-Overwrite: 1`. Status transitions render from `getAllowedTransitions()` in `@lore/core` — never hardcode the lifecycle.
- **Edit-session state must not survive doc navigation.** `docs.$id.tsx` mounts `<DocDetail>` with `key={doc.id}` so a warm query-cache hit can't reuse a component instance carrying another doc's unsaved editor state. Save/Cancel clears the draft debounce timer before `clearDraft`.
- **No login UI.** Packaged mode (default): the SPA never sees a bootstrap token at all — the machine-scope session is minted server-side by the one-time nonce redirect (`GET /auth/bootstrap?nonce=<n>`, see the http adapter CLAUDE.md) BEFORE the SPA loads; `src/lib/bootstrap.ts::bootstrapAuthIfNeeded()` finds no `window.__LORE_BOOTSTRAP_TOKEN__` and no-ops (its pre-existing dev-mode behavior, unchanged). `--dev`: `lore dashboard --dev` creates/reuses a machine-scope `dashboard-local` API key cached at `<machine-auth base dir>/local-key` (NOT `.lore/local-key` — SPEC-078 D1 moved the dashboard cookie-auth store to the machine-wide XDG state dir), injects the raw key into the vite child as `VITE_LORE_BOOTSTRAP_TOKEN`, and `bootstrapAuthIfNeeded()` exchanges it for an HttpOnly `lore_sid` cookie via `/api/auth/local-bootstrap`, then deletes the window global. Every `fetch` carries `credentials: "include"` in both topologies.
- **Depends on `@lore/core` only.** `packages/dashboard/package.json` MUST NOT depend on `@lore/lore`. Boundary check: `grep -r 'from "@lore/lore"' src/` → 0.
- **No server-side modules in `src/`** (`bun:sqlite` / `child_process` / `node:fs`). Boundary check: `grep -rE 'bun:sqlite|child_process|node:fs' src/` → 0.
- **TanStack Router file-routing** under `src/routes/`; `routeTree.gen.ts` is git-ignored, regenerated by the Vite plugin + `prebuild`. Don't commit it.
- **All client state is server state (TanStack Query) + URL state (router)** — no Zustand/Jotai/Redux. Filters/search params use `validateSearch` + `Route.useSearch()`, never `useState` (`/library`'s type/status/tag filters are the reference). Documented exception: `use-triage-keyboard.ts`'s row-selection index (ephemeral, mirrors the editor-draft-ephemera precedent).
- **Dark mode**: Tailwind v4's `dark:` variant is overridden to class-based in `src/index.css` (`@custom-variant dark (&:where(.dark, .dark *));`) — v4 defaults `dark:` to `prefers-color-scheme`, which would leak an OS-dark scheme into the app's light theme.
- **`NewDocModal` refuses `docType === "spec"`** (disabled in JSX + guarded in `handleSubmit`) — the spec-create gate needs skeleton headings plus a separate `lore ac add` call, unsatisfiable by one create payload. Use CLI `lore create spec` or `/lore-design`.
- **E2E fixtures creating a `spec` via `/api/dashboard/docs` must supply `## Overview/Goal` / `## Scope` / `## Acceptance Criteria` headings** — the spec-create gate denies content-less specs and `NewDocModal` has no content field, so seed specs out-of-band via `page.request.post`.
- **E2E ports are hardcoded** (8787/5173, `tests/e2e/global-setup.ts`) — free those ports before running locally. `assertPortFree`/`assertServerIsOurs` fail loud rather than reuse a squatting server (a stale `lore dashboard` once polluted the real team corpus this way).
- **The multi-project e2e family runs under its own config** — pass `--config=tests/e2e/playwright.multi-project.config.ts`; the default config makes those specs self-skip (exit 0), so omitting `--config` is a vacuous pass.

## Conventions

- `src/lib/api.ts` — typed fetch wrapper (`Result<T, ApiError>`, 5s abort timeout). All reads go through it; nothing else touches `fetch` directly.
- `src/api/mutations.ts` — write client (`DashboardApiError`/`ConflictError`). `apiPostRouteView` is the one deliberate fire-and-forget exception (telemetry ping — never throws, never surfaces a toast).
- Single-source shared components — don't reimplement independently: `JudgmentBadge` (review-judgment badge, mirrors CLI `formatJudgmentBadge`), `Breadcrumb` (ancestor-chain trail), `DiffView` (unified-diff renderer, shared by HistoryTab + ConflictModal), `TYPE_ACCENT` (`src/lib/type-accent.ts`, per-type accent color), `formatTypeMetaLabel` (per-type meta-row text, mirrors CLI `formatWorkflowBadge`).
- Evidence/adjudication surface: `EvidenceTab` dispatches over `GET /api/evidence-panel/:idOrSlug`'s `EvidencePanelProjection` union onto 3 panel components (`src/components/evidence/`); consumers never re-derive coverage/attestation math — always read `@lore/core`'s `computeAcCoverage`/`deriveAttestationSummary`/`summarizeForAdjudicationBar` output verbatim.
- ⛔ **A plan attestation surface must AND `meets_floor` with the declared-scope conjunct, never render `meets_floor` alone** — the latter is ratio-only, so a scope-undeclared plan renders as passing while `plan-close` denies it. Read `PlanEvidencePanel.declared_scope_verdict` (three-valued) and combine by the gate's own precedence, FAIL > NOT-APPLICABLE > PASS, giving three distinct states (meets floor / below floor / **scope undeclared**); the combinator is a precedence pick, never a re-derivation.
- `useSuspenseQuery` + `<Suspense>` for loading; shadcn `<Skeleton/>` for shimmer. Component primitives live under `src/components/ui/`.
- Project-scoped route mirrors under `src/routes/p.$name.*.tsx` reuse their top-level sibling's body via a thin-wrapper + props-driven split (binding hazard: a route with its own `Route.useSearch()`/`useParams()` must not be reused directly).
- 6-dimension test coverage (HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/REGRESSION) required for `api.ts`, `mutations.ts`, `draft.ts`, and every write component.

## Links

- Depends on: [`@lore/core`](../core/src/CLAUDE.md) — types, plus the RUNTIME issue-resolution
  vocabulary (`ISSUE_RESOLUTION_MEMBERS`, re-exported from `src/lib/api.ts` as
  `ISSUE_RESOLUTIONS`). ⛔ The dashboard constructs no resolution list of its own: both
  `IssuesList`/`IssueDetail` switches are exhaustive over the imported union, so adding a
  member upstream fails to compile HERE (TS2322 to `never`) rather than rendering an
  undefined badge variant — which CVA's `defaultVariants` silently absorbed as a SUCCESS
  badge before that weld existed.
- Talks to: `@lore/lore`'s [`adapters/http`](../lore/src/adapters/http/CLAUDE.md) over `/api/*`; the built `dist/**` is also embedded into and served BY that same adapter in packaged mode (`dashboard-assets-loader.ts` + `static-serving.ts`).
- Consumed by: the user opens `http://localhost:8787` directly in packaged mode (default `--api-port`), or `http://localhost:5173` under `--dev`.

## Out of scope

- Deployment to Vercel / remote (defer).
- Richer session-expiry recovery UX (a guided re-bootstrap modal/prompt beyond the shipped path). Shipped: a cold start without a valid `lore_sid` cookie renders the existing unauthenticated read state; its guidance names re-running `lore dashboard` (which mints a fresh one-time nonce and redirects into a new session) as the fix — no standing credential endpoint exists to make this "seamless".
- i18n.
