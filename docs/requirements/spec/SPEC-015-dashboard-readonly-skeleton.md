---
id: SPEC-015
type: spec
role: spec
title: "Dashboard — Read-only Skeleton"
status: draft
priority: high
phase: P7
created: 2026-06-27
updated: 2026-06-27
tags: [dashboard, frontend, vite, react, shadcn, read-only, phase-7]
parent: PRD-001
links:
  - {id: SPEC-014, type: depends-on, note: "Monorepo skeleton — @lore/dashboard slot created"}
  - {id: SPEC-010, type: consumes, note: "Bearer-auth HTTP API; dashboard talks to /api/* via local proxy"}
  - {id: SPEC-011, type: consumes, note: "Route layout — /api/docs, /api/search, /api/tree, /api/docs/:id"}
  - {id: SPEC-004, type: consumes, note: "OutlineService MDX placeholder resolution for /docs/:id render"}
---

# SPEC-015: Dashboard — Read-only Skeleton

## 1. Purpose

Land the first end-to-end frontend for Lore — a local-developer web UI hosted by the `@lore/dashboard` package that reads the corpus through the existing `lore serve` HTTP API. **Read-only only**: list / search / tree / detail. No auth, no write paths. This SPEC fills the `packages/dashboard/` slot that SPEC-014 left empty, validating that the Vite + React + shadcn stack is healthy in a Bun-workspaces monorepo and that the existing HTTP read-side surface is sufficient to drive a working UI.

## 2. Goals & Non-Goals

### 2.1 Goals

- Stand up `@lore/dashboard` as a Vite + React 19 + shadcn/ui project under `packages/dashboard/`.
- Four routes — list (`/`), search (`/search`), tree (`/tree`), detail (`/docs/:id`) — that fetch real data from `lore serve` and render via shadcn components.
- Local development workflow: two terminals (`lore serve` on :8787, `bun run --filter '@lore/dashboard' dev` on :5173). Vite proxies `/api/*` to the lore server so the browser sees a single origin.
- Single API extension: `GET /api/docs/:id?resolveMdx=true` returns the doc with MDX placeholders resolved (parity with `lore get --resolve-mdx`). All other endpoints reused as-is.
- TanStack Query for cache + invalidation; TanStack Router for type-safe file routing.
- Unit + component tests with vitest + Testing Library covering the six standard dimensions.
- `bun run typecheck` covers the new dashboard package; existing 1342-test oracle stays green.

### 2.2 Non-Goals (explicit)

- ❌ Auth / login / cookie session (→ SPEC-016).
- ❌ Create / edit / approve / reject / delete UI (→ SPEC-017).
- ❌ Diff viewer, version log, restore UI (→ later SPEC).
- ❌ Vite production build + `lore serve` mounting static assets.
- ❌ Embedding the dashboard bundle into the `dist/lore` single binary.
- ❌ Deployment to Vercel / any remote target.
- ❌ End-to-end browser tests (Playwright / Cypress) — defer until SPEC-016 adds auth flow worth E2E-ing.
- ❌ Internationalisation, multiple colour themes beyond light/dark/system.
- ❌ Optimistic update logic (no write paths to optimise).
- ❌ Server-side rendering / static export.

## 3. Architecture

### 3.1 Local-development topology

```
Terminal A                Terminal B                  Browser
──────────                ──────────                  ───────
$ bun run dev             $ bun run --filter           http://localhost:5173
  → lore serve              '@lore/dashboard' dev      │
  → :8787                 → vite :5173 ◄───────────────┘
  → /api/*                   │
                             └── proxy /api/* ──► localhost:8787
```

- Two-process model. Devs accept this as the local-dev cost; we will not introduce a wrapper that spawns both.
- Vite's dev server is the entrypoint the browser hits (HMR + asset transform).
- Vite config's `server.proxy` block forwards `/api` to `http://localhost:8787` (the default `lore serve` port). The browser thus sees one origin (`http://localhost:5173`) — no CORS concerns.
- `lore serve` is **unchanged** in posture: it keeps producing JSON envelopes; no CORS headers required; no new auth path.

### 3.2 Package layout

```
packages/dashboard/
├── package.json            ← @lore/dashboard; deps + dev/build/test scripts
├── vite.config.ts          ← React plugin + proxy + alias @/* → src/*
├── tsconfig.json           ← extends ../../tsconfig.base.json + jsx: "react-jsx"
├── tsconfig.tests.json     ← extends tsconfig.json + include tests/
├── tailwind.config.ts      ← shadcn standard (preset paths, content: ["./index.html", "./src/**/*.{ts,tsx}"])
├── postcss.config.js       ← tailwindcss + autoprefixer
├── components.json         ← shadcn config (style: "new-york", baseColor: "slate", cssVariables: true)
├── index.html              ← Vite SPA entry; <div id="root" />
└── src/
    ├── main.tsx            ← createRoot + RouterProvider + QueryClientProvider + ThemeProvider
    ├── index.css           ← Tailwind base / components / utilities + shadcn css vars
    ├── routes/             ← TanStack Router file-routing
    │   ├── __root.tsx      ← root layout: <nav> + <theme-toggle> + <Outlet/>
    │   ├── index.tsx       ← list view at "/"
    │   ├── search.tsx      ← "/search?q=..."
    │   ├── tree.tsx        ← "/tree"
    │   └── docs.$id.tsx    ← "/docs/$id"
    ├── lib/
    │   ├── api.ts          ← typed fetch wrapper (timeout / error normalize)
    │   ├── query-client.ts ← TanStack Query default options
    │   └── theme.ts        ← light/dark/system toggle + localStorage persist
    ├── components/
    │   ├── ui/             ← shadcn generated primitives (button, card, input, table, badge, scroll-area, separator, skeleton, sonner, dropdown-menu)
    │   ├── DocCard.tsx     ← list-row card
    │   ├── DocDetail.tsx   ← detail view body
    │   ├── DocTree.tsx     ← recursive tree node
    │   ├── SearchBar.tsx   ← search input + submit
    │   └── ThemeToggle.tsx ← shadcn dropdown
    └── types.ts            ← thin local re-exports of types from @lore/core (DocType, Status, etc.)
└── tests/
    ├── unit/
    │   └── lib/
    │       └── api.test.ts
    └── component/
        ├── DocCard.test.tsx
        ├── DocDetail.test.tsx
        ├── DocTree.test.tsx
        └── SearchBar.test.tsx
```

### 3.3 Technology stack (locked)

| Concern | Decision | Why |
|---|---|---|
| Bundler / dev server | Vite 7+ | Locked in prior brainstorm |
| Framework | React 19 + TypeScript strict | Locked |
| Component primitives | shadcn/ui (Radix + Tailwind v4) | Locked. `npx shadcn@latest init` standard scaffold |
| Router | TanStack Router (file-routing) | Type-safe params; file convention matches shadcn templates; auto-generates `routeTree.gen.ts` |
| Data fetching / cache | TanStack Query | Read-heavy; built-in suspense + caching + invalidation; standard React data layer |
| Client state | None (no global store) | All app state is server state (TanStack Query) + URL state (router). No Zustand/Jotai. |
| HTTP client | Native `fetch` wrapped in `lib/api.ts` | Avoids generated-client tooling weight in v1 |
| Markdown render | `react-markdown` + `remark-gfm` | Renders both raw markdown and resolved-MDX output |
| Theme | shadcn `slate` neutral; light / dark / system | Standard template; persisted in localStorage |

Explicitly NOT used: Next.js, Remix, Wouter, React Router v6, Redux/Zustand/Jotai, tRPC, OpenAPI codegen, MUI/Chakra/Mantine, Storybook, Playwright/Cypress.

### 3.4 API surface used

Read-side endpoints in `packages/lore/src/adapters/http/routes.ts` (per SPEC-011):

| Endpoint | Used by route | Notes |
|---|---|---|
| `GET /api/status` | `__root.tsx` health indicator | Included in v1; renders a small "connected" / "offline" pill in the nav |
| `GET /api/docs?type=&status=&limit=` | `/` (index) | Existing; covers the list view |
| `GET /api/search?q=&type=&limit=` | `/search` | Existing |
| `GET /api/tree?root=&depth=` | `/tree` | Existing |
| `GET /api/docs/:idOrSlug` | `/docs/$id` | Existing — but needs `?resolveMdx=true` option (see §3.5) |

**No write endpoints called.** No new endpoints introduced other than the `resolveMdx` query option below.

### 3.5 Backend extension: `?resolveMdx=true`

Today `GET /api/docs/:id` returns the raw `DocRecord`. The dashboard detail page needs the same MDX-placeholder resolution that `lore get --resolve-mdx` performs via `OutlineService.resolve()`. Extend the handler:

- Add `resolveMdx` query parsing: `?resolveMdx=true` (boolean — false / absent = no change in behaviour).
- When true: after fetching the doc, call `app.outlineService.resolve(doc.content, doc.id)` and replace `doc.content` with the resolved markdown before serializing.
- Keep the JSON envelope shape (`{ ok: true, data: { doc, navigation } }`); only `doc.content` changes when the flag is set.

This is a single-line behaviour change in `routes.ts` (plus a unit test). NOT a new route, NOT a breaking change to the existing response.

### 3.6 Theme + accessibility

- shadcn default `slate` neutral palette; CSS variables driven; light/dark/system tri-state.
- All interactive elements get accessible names from shadcn defaults (Radix primitives).
- Keyboard nav: TanStack Router handles routing keyboard; shadcn dropdown/dialog inherit Radix keyboard semantics.
- `prefers-reduced-motion` respected by shadcn defaults.

## 4. Implementation Plan

Eight milestones. M1–M3 main-agent-direct (config + scaffold). M4–M6 implementer (UI + tests). M7–M8 main-agent oracle gate.

1. **M1 — Vite + Tailwind + shadcn scaffold** (main agent). Create `packages/dashboard/{package.json, vite.config.ts, tsconfig.json, tailwind.config.ts, postcss.config.js, components.json, index.html, src/main.tsx, src/index.css}`. Add deps to dashboard package: `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `react-markdown`, `remark-gfm`, plus devDeps for `vite`, `@vitejs/plugin-react`, `tailwindcss@4`, `autoprefixer`, `postcss`, `@types/react`, `@types/react-dom`. Add root script `dev:dashboard` (fan-out).

2. **M2 — shadcn primitives** (main agent). `npx shadcn@latest init` then add the v1 primitive set: `button`, `card`, `input`, `table`, `badge`, `scroll-area`, `separator`, `skeleton`, `dropdown-menu`, `sonner`. Lands under `src/components/ui/`.

3. **M3 — Backend `resolveMdx=true`** (main agent). Patch `packages/lore/src/adapters/http/routes.ts` `handleSingleDoc()` to honour `resolveMdx` query. Add a small bun-test under `packages/lore/tests/unit/adapters/http/routes.test.ts` proving the flag triggers `OutlineService.resolve`.

4. **M4 — `lib/api.ts` + `query-client.ts` + routing skeleton** (dispatch implementer). Typed fetch wrapper that returns `Result<T, ApiError>`-shaped object. TanStack Query client config (5min stale-time default). TanStack Router file-routing with the four routes + root layout + theme toggle.

5. **M5 — Four pages + components** (dispatch implementer). Implement `DocCard`, `DocDetail`, `DocTree`, `SearchBar`, `ThemeToggle`. Wire each route to TanStack Query hooks calling `lib/api.ts`. Render loading via shadcn `Skeleton`; render errors via `Sonner` toast + inline message.

6. **M6 — Tests** (dispatch implementer, six-dim coverage). Unit tests for `api.ts` (HAPPY/NEG/BOUND/ERR/STATE/REGR). Component tests for each component using `@testing-library/react` + jsdom env. Target: ≥20 tests new in `packages/dashboard/tests/`.

7. **M7 — Documentation sync** (main agent). Update root `CLAUDE.md` to mention dashboard package; write `packages/dashboard/CLAUDE.md` describing the topology + stack + how to extend.

8. **M8 — Oracle gate** (main agent). `bun install`; `bun run typecheck` (4 stages + new dashboard tsconfig); `bun run test:vitest` (counts include new dashboard tests); `bun run test:bun` (unchanged 388); smoke: `bun run --filter '@lore/dashboard' dev` starts Vite without error; manual browser-open optional but recorded.

## 5. Acceptance Criteria

### 5.1 Structural

- `AC-D-S1`: `packages/dashboard/` contains `package.json` (name `@lore/dashboard`, private, type `module`), `vite.config.ts`, `index.html`, `tsconfig.json`, `tsconfig.tests.json`, `tailwind.config.ts`, `postcss.config.js`, `components.json`, `src/main.tsx`, `src/index.css`.
- `AC-D-S2`: `packages/dashboard/src/components/ui/` contains the v1 shadcn primitives listed in M2.
- `AC-D-S3`: Five files under `src/routes/`: `__root.tsx`, `index.tsx`, `search.tsx`, `tree.tsx`, `docs.$id.tsx`. `routeTree.gen.ts` is **git-ignored** and regenerated by `@tanstack/router-plugin` on Vite startup + `prebuild` script (no checked-in generated code).

### 5.2 Runtime (manual / scripted smoke)

- `AC-D-R1`: `bun run --filter '@lore/dashboard' dev` exits-0-on-Ctrl-C and prints the Vite ready URL (`http://localhost:5173`) within 5 seconds.
- `AC-D-R2`: Browser open of `/` (with `lore serve` running and `.lore/lore.db` populated) renders ≥1 doc card with title + type + status.
- `AC-D-R3`: `/search?q=spec` renders ≥1 result (the corpus contains 13 specs today).
- `AC-D-R4`: `/tree` renders the PRD root and at least one spec child.
- `AC-D-R5`: `/docs/<existing-id-or-slug>` renders title, metadata, body, and navigation footer.

### 5.3 Backend extension

- `AC-D-B1`: `GET /api/docs/:id?resolveMdx=true` returns a `doc.content` string containing the resolved output of OutlineService (unit test asserts a known placeholder is expanded).
- `AC-D-B2`: `GET /api/docs/:id` without the flag returns the unchanged raw content (regression).

### 5.4 Oracle

- `AC-D-O1`: `bun run typecheck` exits 0; the dashboard tsconfig is added to the root `typecheck` script.
- `AC-D-O2`: `bun run test:vitest` passes 954 + ≥20 new dashboard tests (= ≥974) with no failures.
- `AC-D-O3`: `bun run test:bun` passes 388 + the new routes test (= ≥389) with no failures.
- `AC-D-O4`: `grep -rE "from \"@lore/lore\"" packages/dashboard/src/` returns zero hits (dashboard depends on `@lore/core` only, talks to `@lore/lore` over HTTP).

### 5.5 Boundary

- `AC-D-Bnd1`: `packages/dashboard/package.json` lists `@lore/core` as a dependency, NOT `@lore/lore`.
- `AC-D-Bnd2`: No file under `packages/dashboard/src/` imports a server-side helper (no `bun:sqlite`, no `child_process`, etc.). Grep proof acceptable.

## 6. Out-of-scope rejections

Requests during implementation MUST be deferred and not silently bundled:

- Auth UI / cookie store / login form.
- Any create / edit / delete / approve / reject mutation, even "just one harmless mutation to prove the pattern".
- Diff viewer or version-history UI.
- Static asset embedding into `dist/lore`.
- E2E (Playwright/Cypress) browser tests.
- Switching frameworks (Next.js, Remix), routers (React Router v6, Wouter), or state libraries.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| TanStack Router code-generation step in monorepo confuses bun/Vite | Use the Vite plugin (`@tanstack/router-plugin`); `routeTree.gen.ts` is git-ignored and regenerated at dev/build time. The `.gitignore` entry plus an explicit `prebuild` script in dashboard `package.json` keeps fresh checkouts and CI deterministic |
| Tailwind v4 + shadcn config in a monorepo subpath (Tailwind v4 dropped `tailwind.config` autodiscovery in favour of CSS-first config) | Follow shadcn's official Tailwind-v4 instructions verbatim; the `@import "tailwindcss"` directive in `src/index.css` is the canonical setup |
| Vite proxy fails when `lore serve` is not running | Show a clear error toast in the dashboard if `/api/*` returns network errors; document the two-terminal flow in `packages/dashboard/CLAUDE.md` |
| `?resolveMdx=true` performance on big PRDs with many placeholders | Outline resolution is per-request; if a query measures noticeably slower than raw fetch, add a server-side cache (TODO future SPEC). For SPEC-015 we accept current per-request cost |
| `bun install` in workspaces re-installs every workspace's deps | Existing `bunfig.toml` `linker = "hoisted"` keeps natives at root; dashboard's tree adds ~50 packages — acceptable |
| Vitest needs jsdom for component tests; current vitest config uses node env | Add a per-package `vitest.config.ts` in `packages/dashboard/` with `test.environment = "jsdom"` so dashboard tests opt in, leaving the rest unchanged |

## 8. Open questions (deliberately none at brainstorm time)

If a real unknown surfaces during M1–M8 (e.g. shadcn dropped a primitive we need; TanStack Router 1.x behaviour changes; Vite 7 plugin issues), record it inline here as an addendum rather than silently choosing.
