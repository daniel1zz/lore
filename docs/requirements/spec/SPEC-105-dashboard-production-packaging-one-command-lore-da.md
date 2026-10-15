---
id: SPEC-105
type: spec
role: spec
title: "Dashboard production packaging — one-command lore dashboard (F5a)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-10-10
tags: [dashboard, packaging, f5a]
links:
  - {id: SPEC-100, type: implements}
---
# Spec: Dashboard production packaging — one-command `lore dashboard` (F5a)

## Overview/Goal

Deliver the dashboard as a production static bundle embedded in the compiled `dist/lore` binary and served by `lore serve`'s HTTP adapter, so `lore dashboard` alone yields a browsable, authenticated UI with NO vite process. This retires the two-process dev topology as the only launch path (dev mode remains for dashboard development, behind `--dev`). Upstream: domain doc `spec-domain-overview-dashboard-console-admin-console-evolution-adjudication-workbench-first` (F5a, owner decision D6); evidence `knowledge-dashboard-human-friendliness-evaluation-2026-07-28`.

Boundary: local-only. No hosting, no multi-tenant, no auth-model change — this is NOT "distribution" under the 2026-07-28 distribution freeze (nominal term collision only; see domain doc D6).

## Scope

In: vite production build wired into the single-binary build; static serving + SPA fallback in the HTTP adapter; packaged-path auth via one-time nonce redirect; origin allowlist computed from actual ports; `lore dashboard` default flip to packaged mode (`--dev` keeps vite); single-process e2e harness (`test:e2e:static`); build-freshness stamp covering dashboard sources; `packages/dashboard/CLAUDE.md` out-of-scope claims updated at landing.

Out: F5b cockpit (ship-gated on tiered review); any new write semantics; SSE/live push; remote deployment; `vite.config.ts` `base` changes (stays `/`).

## Design Decisions (trade-offs adjudicated; DD-2 reversed once by security review — recorded)

### DD-1 Asset delivery: EMBED into the compiled binary, via a committed loader over a git-ignored generated manifest

**Chosen: embed.** `scripts/build.ts` gains a dashboard step: invoke the dashboard build through its package lifecycle (`bun run --filter '@lore/dashboard' build`, so `prebuild` routeTree generation fires — never a bare `vite build`), then generate `packages/lore/src/generated/dashboard-assets.ts` — a manifest module importing every `packages/dashboard/dist/**` file with `with { type: "file" }` so `bun build --compile` embeds them (file-embed mechanism precedent: the libsql `.node` plugin). Runtime reads via `Bun.file(embeddedPath)`. Map shape: `urlPath → { embedded, contentType, immutable }` + a build stamp `{ digest, builtAt, dashboardVersion }` where `digest` hashes `packages/dashboard/src/**` + lockfile-relevant config (the freshness identity).

- Rationale: single artifact — binary↔assets version skew impossible by construction; distribution stays one file. `dist/lore` size delta recorded at landing (observation, not a gate — domain doc D6).
- Rejected: sibling dir read at runtime — reintroduces the stale-asset skew class this repo has been burned by, breaks single-binary install.
- **Git contract (resolves the tracked-vs-ignored contradiction found in review)**: `dashboard-assets.ts` is git-ignored (its content churns with every hashed-filename build — unlike the committed, stable `assets-manifest.ts` precedent). To keep fresh-clone `bun run typecheck` and source-runs sound, the static-serving code NEVER imports it statically: a **committed** `dashboard-assets-loader.ts` owns a guarded dynamic import and returns a typed union `{ available: true, manifest } | { available: false, reason }`. Fresh clone: typecheck passes (loader is self-contained), source-run packaged mode fails LOUD naming the fix (`bun run build` or `lore dashboard --dev`) — never a silent fallback.
- Build tax control: the dashboard step short-circuits on an unchanged content digest (stamp comparison) — `bun run build` for server-only changes stays cheap; `--skip-dashboard` exists for emergency only and marks the stamp `skipped` (loud in `/api/health`).
- **Fifth false-oracle vector closed**: the freshness identity includes dashboard sources, and the static e2e harness asserts the served stamp digest matches a freshly computed one — a stale embedded bundle is `inconclusive`, not a pass.

### DD-2 Packaged-path auth: one-time nonce redirect (chosen; request-time token injection REJECTED after security review)

First draft chose request-time injection of `window.__LORE_BOOTSTRAP_TOKEN__` into served index.html (loopback + Origin gated), claiming parity with the dev-mode vite plugin. Security review refuted the parity claim: TCP loopback has NO UID isolation — on a multi-user machine any co-resident user can `curl` with a forged Origin header and harvest the long-lived machine key, whereas `.lore/local-key` is 0600 single-owner; HTTP standing exposure is strictly broader than the file. Additional findings: top-level GET navigations commonly omit `Origin` (the POST-CSRF check is a category mismatch on a GET path), and re-injection on every SPA fallback creates an unbounded exposure window. Decision reversed.

**Chosen: one-time nonce redirect.** `lore dashboard` (packaged mode) mints a cryptographically random single-use nonce held ONLY in server process memory (Map, 60s TTL, consumed-on-first-use), and opens the browser at `http://localhost:<apiPort>/auth/bootstrap?nonce=<n>`. The handler validates + consumes the nonce, mints the `lore_sid` session via the existing machine-scope `sessionStore.create` (same store, same cookie attributes as `handleLocalBootstrap`), and 302-redirects to `/`. Properties:

- The machine key is NEVER served over HTTP. index.html carries NO secret — the entire injected-HTML threat surface (cache, bfcache, extensions, curl harvesting) vanishes.
- Nonce in URL/history is harmless: single-use, consumed within the launch instant, expired thereafter; the endpoint answers 410 for consumed/expired/unknown nonces.
- SPA changes: zero. `bootstrapAuthIfNeeded` finds no window global → skips (existing behavior); the cookie is already set by the redirect.
- Cold start without cookie (deep link after session expiry): the UI renders the existing unauthenticated state, whose guidance names `lore dashboard` re-launch as the re-auth path. Accepted for a local tool; no standing credential endpoint exists to make it "seamless".
- `lore serve` alone (no `lore dashboard`) serves the static UI but mints no nonce — read surfaces show the unauthenticated state. Deliberate: serve is an API server; dashboard is the human entry.
- Dev mode (`--dev`) keeps the existing vite-plugin token flow untouched (SPEC-016 §3.7 anti-leak invariant unchanged).

### DD-3 Origin allowlist: computed from actual bound ports, never hardcoded

Packaged mode is single-origin: allowlist = `buildAllowedOrigins`-derived values for the ACTUAL apiPort only, threaded through `HttpConfig.allowedOrigins` at every Origin-checking call site. Dev-mode origins (vite port) are included ONLY under `--dev`, computed from the real `--dashboard-port` — retiring the known 5173 hardcode defect (`task-dashboard-bootstrap-origin-allowlist-hardcodes-port-5173`). The nonce endpoint itself is exempt from Origin checking (it is a top-level GET navigation; its guard is the nonce, not Origin) but validates `Sec-Fetch-Site`/`Sec-Fetch-Mode` when present (must be none/navigate — reject subresource/iframe fetches).

### DD-4 Route priority: `/api/*` first, exact static second, SPA fallback last — fallback never shadows `/api`

Dispatch order in the Bun.serve fetch handler: (1) existing `/api/*` dispatch untouched, including `/api/p/:name/*` (SPEC-078) — unknown `/api/*` still returns the JSON 404, NEVER index.html; (2) `/auth/bootstrap` nonce endpoint; (3) exact static asset matches (hashed filenames → `Cache-Control: immutable`; `index.html` → `no-cache` for freshness — it carries no secret, so `no-store` is unnecessary); (4) GET SPA fallback serving index.html for non-`/api` paths, covering client routes including `/p/:name/*` (SPEC-078 client routing unaffected; server `/api/p/` prefix shim untouched; vite `base` stays `/`).

### DD-5 `lore dashboard` default flip: packaged mode default, `--dev` opt-in

Packaged mode: assert assets available via the DD-1 loader (unavailable → exit non-zero naming `bun run build` / `--dev`), start `startHttpServer` with static serving enabled, mint nonce, open browser at the nonce URL — one process, one command. `--dev` retains today's behavior (vite child + `VITE_LORE_BOOTSTRAP_TOKEN` + proxy). `--api-port` semantics unchanged; `--dashboard-port` only meaningful under `--dev`.

### DD-6 Single-process e2e harness (named deliverable with named wiring)

New Playwright pair `playwright.static.config.ts` + `global-setup-static.ts`: ensure a fresh dashboard build (digest short-circuit makes repeats cheap), spawn the packaged serving stack against a throwaway corpus (mkdtemp + init), `baseURL http://localhost:8787`, assert NO vite process, assert served build-stamp digest matches freshly computed digest (freshness oracle), authenticate via the nonce URL (request it from the spawned process's stdout handshake). npm script: `test:e2e:static` in `packages/dashboard/package.json`; CI runs it alongside the existing e2e job (same serial/fixed-port discipline, `assertPortFree`/`assertServerIsOurs` reused).

## Failure Modes

| Failure | Detection | Behavior |
|---|---|---|
| Dashboard dist missing at binary build | `scripts/build.ts` precheck | Build fails loud naming the dashboard build step |
| Source-run packaged mode without built assets | DD-1 loader `{available:false}` | `lore dashboard` exits non-zero naming `bun run build` / `--dev` |
| Embedded asset read failure at runtime (corrupt/missing entry) | `Bun.file` read guarded per request | 500 for that asset with server log naming the entry; `/api/*` unaffected |
| Machine-auth store unavailable (disk-full/permission) | guarded at nonce mint + session validate | Static UI still serves (unauthenticated state); nonce endpoint 503 with actionable message; NEVER a blanket 500 on page loads |
| Nonce consumed/expired/unknown | nonce store lookup | 410 + human-readable page naming `lore dashboard` re-launch |
| Port squatting on apiPort | existing startup checks + e2e `assertServerIsOurs` | Fail loud, never serve on a squatted port |
| Unknown `/api/*` route | DD-4 order | JSON 404 (never SPA fallback) |
| Stale embedded bundle vs dashboard source | build stamp digest vs fresh hash (build-time short-circuit + static e2e assert) | Build refreshes it; e2e reports `inconclusive`-class failure, not a pass |

## Observability

- `GET /api/health` gains `dashboard: { embedded, digest, builtAt, skipped? }` (DD-1 stamp; `skipped: true` when `--skip-dashboard` was used — loud).
- Packaged-mode startup log: static serving enabled, origin allowlist in effect, nonce URL (once), browser open result.

## Security review (STRIDE-lite, packaged path — post-reversal)

- Spoofing/credential theft: machine key never on the wire; nonce single-use + TTL + `Sec-Fetch-*` navigation guard; cookie HttpOnly/SameSite=Strict unchanged. Co-resident-user harvesting (the DD-2 reversal driver) eliminated — a raced nonce grants one session, visible as the human's browser then failing to authenticate (loud), not a silent long-lived key theft.
- Tampering: assets embedded in binary — no on-disk asset tampering surface post-build; index.html is static bytes (no per-request interpolation surface).
- Info disclosure: built artifact carries no token mechanism (grep-able build oracle); index.html secret-free.
- DoS: nonce store bounded (single entry per launch, TTL-evicted).
- Elevation: session minting still goes through the machine-scope sessionStore; no auth-model change.

## Consumer contracts (downstream handoff)

- implement: touches `scripts/build.ts` (dashboard step + manifest gen + digest short-circuit), NEW committed `packages/lore/src/adapters/http/dashboard-assets-loader.ts` (or generated/ sibling; committed), NEW git-ignored `packages/lore/src/generated/dashboard-assets.ts`, NEW static-serving + nonce module in `packages/lore/src/adapters/http/`, `commands/dashboard.ts` (default flip, nonce mint, stdout handshake), `auth.ts`/`index.ts` (allowlist threading, dispatch order), `packages/dashboard/package.json` (`test:e2e:static`), new e2e config pair, `.gitignore`, `packages/dashboard/CLAUDE.md`. NO `packages/dashboard/src/**` changes (DD-2 keeps the SPA byte-identical).
- test: oracles = ACs below + failure-modes table; six-dimension coverage on the static-serving/nonce module (it is a write-path-adjacent auth surface).
- deploy: none (local binary).


## Acceptance Criteria (structured)

- [⊘] [script] AC-F5A-1: Clean-checkout bun run build embeds dashboard assets and dist/lore dashboard --no-open serves GET / (200 HTML), a hashed asset (200 immutable), and /api/health with dashboard build stamp — with no vite process running
  script: e2e — cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.static.config.ts -g "packaged serve"
- [⊘] [script] AC-F5A-2: Nonce auth flow: first GET /auth/bootstrap?nonce=N answers 302 with Set-Cookie lore_sid and redirect to /; replay of the same nonce answers 410; the authenticated session can read corpus data via /api
  script: e2e — cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.static.config.ts -g "nonce"
- [⊘] [script] AC-F5A-3: Built artifact is secret-free: served index.html and all built assets contain no __LORE_BOOTSTRAP_TOKEN__ mechanism and no local-key material (grep oracle over packages/dashboard/dist and a curl of GET /)
  script: test — bun test packages/lore/tests/integration/static-serving.bun.test.ts -t "secret-free"
- [⊘] [script] AC-F5A-4: Route priority: unknown /api/* answers JSON 404 (never index.html); deep client routes /library and /p/:name/library answer 200 index.html; SPEC-078 /api/p/:name/* dispatch unaffected
  script: test — bun test packages/lore/tests/integration/static-serving.bun.test.ts -t "route priority"
- [⚑] [script] AC-F5A-6: Fresh-clone typecheck contract holds: bun run typecheck passes with packages/dashboard never built (committed loader owns the guarded dynamic import of the git-ignored generated manifest)
  script: tsc — bun run typecheck
- [⊘] [script] AC-F5A-7: Machine-auth store unavailability degrades gracefully: GET / still serves the UI (unauthenticated state) and the nonce endpoint answers 503 with actionable message — never a blanket 500 on page loads
  script: test — bun test packages/lore/tests/integration/static-serving.bun.test.ts -t "auth-store degradation"
- [⊘] [script] AC-F5A-8: Origin allowlist is computed from actual ports: packaged mode allowlists only the api origin; --dev threads the real --dashboard-port (5173 hardcode retired); served build-stamp digest matches freshly computed dashboard source digest in the static e2e (stale bundle is a failure, not a pass)
  script: e2e — cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.static.config.ts -g "allowlist|freshness"
- [⊘] [script] AC-F5A-5: Source-run guard: packaged mode without built assets exits non-zero with a message naming bun run build and --dev; no silent fallback to dev topology. The test MUST control this precondition itself (deterministic regardless of whether a build artifact exists in the checkout)
  script: test — bun test packages/lore/tests/integration/dashboard-command.bun.test.ts -t "source-run guard"
- [⚑] [script] AC-F5A-9: lore dashboard --no-open honours the flag and spawns NO browser opener, despite citty/mri rewriting --no-X into {X:false}: the packaged and --dev startup paths both read the negated form. Oracle intercepts the opener rather than trusting argv parsing.
  script: test — bun test packages/lore/tests/integration/dashboard-command.bun.test.ts -t "no-open"
- [⚑] [script] AC-F5A-10: A consumed/expired/unknown nonce answers 410 with Content-Type text/html carrying the human-readable page the Failure Modes table already demands: it names the lore dashboard relaunch, and forwards an already-authenticated browser to / by probing GET /api/auth/me client-side. A bare JSON envelope on this path is a failure.
  script: test — bun test packages/lore/tests/integration/static-serving.bun.test.ts -t "nonce failure page"

## Code anchors

- scripts/build.ts
- packages/lore/src/adapters/http/static-serving.ts
- packages/lore/src/adapters/http/dashboard-assets-loader.ts
- packages/lore/src/adapters/cli/commands/dashboard.ts
- packages/dashboard/tests/e2e/playwright.static.config.ts
