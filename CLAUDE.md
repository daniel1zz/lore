# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

⛔ Before hand-editing this file, read its content contract: `lore governance claude-md` prints what belongs here vs. the corpus, and the line/byte ceiling enforced by `lore status --check-claude-md`.

## What This Is

**Lore** — AI-native shared knowledge/memory platform for AI-first teams (3-5 people + multiple AI agents). Single binary (`lore`) with three adapters: citty CLI (default), MCP server (`--mcp-server`), and HTTP server (`lore serve`). Storage is local SQLite via `bun:sqlite` by default; with `sync.enabled` it switches to a Turso embedded replica (`@libsql/client`) for multi-machine visibility. Delivers a typed, navigable corpus of PRDs, specs, ADRs, plans, knowledge, and tasks, with MDX placeholder resolution, version history, review workflow, tree-structure conformance checks, telemetry, and v1 migration.

## Dogfooding: Skill/Tool Eval Log

Building Lore is itself run **through** the Lore-governed workflow (corpus chain + skills + gates). Dogfooding is our credibility source: if we don't follow best practice while building the tool that enforces best practice, we can't claim other teams should trust it.

**⛔ Consciously eval every skill/tool we depend on — never assume it is already optimal.** A broken, misleading, or sub-optimal skill/hook/agent/gate is a defect: fix it immediately (or course-correct + record the correct path).

**⛔ Boundary rule (2026-07-22)**: new findings are recorded ONLY in the lore corpus (`lore create knowledge --sub-type retro`), plus at most a one-line standing lesson below. CLAUDE.md never carries full incident narratives — they go stale (proven: a "not yet built" status here outlived the mechanism being built). `docs/claude-md-archive/` is a FROZEN pre-2026-07-22 snapshot — never append to it.

**⛔ A lore defect is fixed at its MECHANISM ROOT and verified from a FRESH consumer install — never patched on whichever surface happened to expose it.** Two questions gate every lore fix: (1) *what mechanism made this possible?* — prose that "should have been followed" is not a mechanism, and a defect already covered by existing prose is proof that the prose layer is the wrong layer; (2) *would a project that just ran `lore init` + `lore setup` still hit this?* — if yes, it is not fixed (BUT a fresh install cannot REACH convergence/diff-shaped defects — removal, retirement, pruning: the probe must construct BOTH ends of the diff plus a live control, else it vacuously passes; `knowledge-retro-a-fresh-install-probe-vacuously-passes`). The fix MUST land on a surface that SHIPS (binary-side output/payload, or `assets/` SSOT + manifest), never only in this repo's own files, this machine's `~/.claude/` copy, or a hand-edited consumer config (see the distribution-first lesson below).

**Standing lessons** (full 33-row history: `docs/claude-md-archive/dogfood-eval-log.md`; several also as lore knowledge docs):

- **Five false-oracle vectors** — exit-code-true ≠ measured-the-right-thing: (1) mistyped AC paths — vitest silently drops non-matching path filters, PARTIAL match exits 0 (zero-match exits 1, loud); (2) under-match generally — after any path/`-t`-filtered run, assert the matched count (`Test Files N`); (3) wrong execution root — worktree `lore verify` ran against the main checkout pre-SPEC-063; (4) stale compiled binary — `.bun.test.ts` files spawning `dist/lore` need `bun run build` first; (5) a silently-inert CLI flag an oracle passes but never verifies took effect — measured: `--no-open` is rewritten by citty/mri into `{open:false}`, so AC-F5A-1 asserted a no-browser topology while every run spawned one (`knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false`). 1–4 are mechanized at the `lore verify` layer (SPEC-061 AC-061-9/10; SPEC-063); 5 cannot be — only the AC can assert the flag's SIDE EFFECT (intercept it, plus a control run proving the interceptor is live). The lesson stands: trust markers prove a command ran, not that it measured the right thing.
- **Contiguous-substring assumption**: matchers/filters built from remembered phrases silently degrade to no-match ("no match + exit 0" is indistinguishable from "passed"); key on lone tokens + independent negative conditions.
- **SSOT↔installed asset pairs** need content-parity or content-invariant assertions — manifest presence alone makes "fixed in both copies" unverifiable (bidirectional divergence observed).
- **Consumer/end-to-end audits**: a writer whose reader was retired, a reader without a writer, a roster map with renamed types, a gate demanding a field no surface can author — all fail SILENT. Every distribution pipe and every gate-read field needs an install→visible / author→trip end-to-end oracle.
- **Worktree dispatch**: `bun install` FIRST in any fresh worktree (module resolution silently walks up into the main checkout — oracles test stale source); verify `git log` on the branch BEFORE merge+cleanup ("Already up to date" on a branch that should carry work = STOP, recover first).
- **Subagent termination discipline is mechanized** (`subagent-stop-commit-guard.mjs`): prose reinforcement measurably failed 4×; a subagent's final message must be a completion/blocked report and its work committed — "completed work" and "committed work" are different states. Known gap: a LIVE background child at hook-fire time can slip past the guard (harness timing, not guard logic — probed sound; do NOT "fix" it) — the git-log-before-merge backstop above remains necessary.
- **Session-start hooks inject computed state, never do blocking work**; static discipline lives in CLAUDE.md layers, hooks carry only dynamic state.
- **Escalation ≠ build**: a twice-recommended mechanization triggers a VERIFICATION pass first, not a build pass — check whether the underlying tool already enforces the invariant (non-force `git worktree remove` needs no guard; git itself refuses).
- **`spawnSync` capturing a growing `--json` payload MUST set explicit `maxBuffer`** (1 MiB default silently truncates); never discard stderr on batch corpus writes; pass multi-arg lore calls as explicit quoted args, never pair-strings. **`set -e` is INERT in the agent shell** (measured: a bare `false` aborts nothing, subshell or top level) — a multi-command batch runs to completion past any failure, so a corpus-write batch is silently partial. Chain with `&&`, or assert the resulting state (e.g. the AC id set) after every batch. Flag values starting with `-` need the `--flag=<value>` equals form (`--statement "--by wins"` parses as a flag and exits 2 — correctly loud, but invisible inside an unchained batch).
- **`mode-$0.md` skill pattern**: pass the mode name as the FIRST token; skills must validate the mode against the known set BEFORE any `Read`.
- **Checklists are a floor, not a ceiling**: after judging every listed invariant, ask what uncatalogued problem this session has (structured-checklist tunnel vision underperforms an unstructured reviewer on unlisted omissions).
- **`lore assess --diff`**: derive the range from the plan's own first task commit — a too-wide range silently converts unrelated work into false scope-drift findings.
- **Serialize Playwright suites** against a fixed dev-server port — concurrent runs contend and produce phantom "browser has been closed" failures.
- **Main-checkout oracle runs need actor identity** (`LORE_ACTOR=agent:main-orchestrator`) — mechanized as the resolveActor OS-fallback advisory (SPEC-035 hotfix).
- **Distribution-first fixes**: an improvement landed only on a machine-local or personal surface (`~/.claude/*`, installed copies) does not exist for consumers — every discipline/hook/skill/prose/number change must name its delivery surface (assets/ SSOT → manifest → setup/binary; config schema for numbers) before it counts as done; a dev symlink into assets/ is a shadow, not a pipeline (`adr-distribution-first-every-improvement-names-its-consumer`).
- **Spec close-outs write NOTHING to CLAUDE.md** — even one-line index entries proved a bloat attractor (26.7KB→52.8KB in 4 days via close-out clauses; then a 73-line/10.4KB index vs a constant byte ceiling); the corpus is the only spec index (`adr-claude-md-specs-section-is-pointer-only-per-spec-index`).
- **In a shared checkout, commit PATH-SCOPED** (`git commit -- <paths>`) — a bare `git commit` after a targeted `git add` also commits whatever ANOTHER live session has staged (observed: a one-line CLAUDE.md edit carried in a co-resident session's file rename under this session's message). No lore invariant catches this: it is neither an anchor collision nor a worktree-dispatch fault.
- **A full-suite verdict requires a CLEAN tree at a named commit** — `git status --porcelain` empty (or run it in an isolated worktree). A dirty concurrent checkout turns another session's in-flight edits and a missing/stale `dist/lore` into phantom regressions of your own: same commit measured 20+ failures dirty vs 4 (all foreign RED tests) clean.
- **A new deterministic gate retroactively invalidates the whole back-catalog** — its predicate evaluates at close time against data authored under the old rules, so every pre-existing doc lands in violation the moment the detector arms (measured: 8 drifts at plan-terminality landing, 2 of 6 plans needing per-task `lore verify` + `assess` + `outline exempt` to close). Budget the one-time sweep AND an explicit retroactive policy in the SAME slice; prefer a written exemption over synthesizing the artifact the predicate looks for — an exemption stays auditable, a doc authored to clear a gate is afterwards indistinguishable from a real one (`knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`).

## Commands

```bash
bun run dev               # Run from source (packages/lore/src/index.ts)
bun run build             # Compile to dist/lore binary (bun build --compile)
bun run typecheck         # tsc --noEmit for all packages + scripts

# Tests — two runners, both must pass
bun run test:vitest       # bunx vitest run — covers non-bun:sqlite files
bun run test:bun          # cd packages/lore && bun test .bun.test
bun run test              # both runners in sequence
bun run test:changed [<base>]  # deterministic worktree oracle: transitive reverse-dep selection across BOTH runners (default base: merge-base main HEAD); --list to preview

# Run a single vitest test file
bunx vitest run packages/lore/tests/unit/service/corpus-service.test.ts

# Run a single bun test file
cd packages/lore && bun test tests/unit/store/sqlite-store.bun.test.ts
```

**Test file convention**: Files ending in `.bun.test.ts` run under `bun test` only (they use `bun:sqlite`). All other `.test.ts` files run under vitest. Do not mix runners.

**Pre-push corpus gate**: `hooks/pre-push` runs three checks before every push — `lore status --check-tree --check-drift`, `lore audit --verify` (SPEC-081 G5), and `lore status --check-prd-budget` (SPEC-080 Phase 3, armed 2026-07-26) — fail-open when `lore`/`.lore/` absent; bypass with `--no-verify`. Byte-identical pair with `assets/project/pre-push` (parity-pinned; regen assets manifest on edit). After clone, activate with `git config core.hooksPath hooks`.

**⛔ Never write to the repo's own `.lore/` corpus from tests or smoke checks.** The repo corpus is the team's live knowledge base. Any manual smoke test or e2e run that creates/edits docs MUST use a throwaway corpus (`mkdtemp` + `lore init`, cwd inside it) — see `packages/dashboard/tests/e2e/global-setup.ts` for the canonical pattern. Also never assume a server answering on port 8787 is yours: a stale `lore dashboard` serving the real corpus once absorbed an e2e write suite (2026-07-07 pollution incident — 6 foreign docs, corrupted export numbering).

## Architecture

### Layer Stack

```
packages/lore/src/adapters/cli/   ← citty CLI (default entry, 32 subcommands)
packages/lore/src/adapters/mcp/   ← MCP stdio server (entered via --mcp-server flag)
packages/lore/src/adapters/http/  ← Bun.serve HTTP + bearer-auth (lore serve) + sync-push
packages/lore/src/app.ts          ← composition root: createApp(dbPath, config?) → App | Result<App>
packages/lore/src/index.ts        ← entry: routes to MCP server or citty CLI based on argv
packages/lore/src/service/        ← business logic, all return Promise<Result<T, LoreError>>
packages/lore/src/store/          ← async storage abstraction (StoreInterface)
packages/core/src/                ← types, errors, Zod schemas, config, telemetry (@lore/core)
packages/lore/src/eval/           ← read-only evaluation scenarios (lore eval)
```

### Key Design Decisions

**Result<T, LoreError>** — no exceptions cross service boundaries. Every service method returns `Promise<{ ok: true; value: T } | { ok: false; error: LoreError }>`. Use `ok()` and `err()` helpers from `@lore/core`. 13 error codes in the discriminated union.

**StoreInterface is async** — methods return `Promise<Result<T, LoreError>>`. This is the contract both `SQLiteStore` (wraps sync `bun:sqlite` calls) and `TursoStore` (`@libsql/client`, natively async) implement. `InMemoryStore` is the test double. Services depend on `StoreInterface`, never on a concrete store.

**Store selection (D-007)** — `createApp(dbPath, config?)`:
- No config / `sync.enabled !== true` → `SQLiteStore` (local-only, returned directly as `App`).
- `sync.enabled: true` + `remote_url` + valid `LORE_SYNC_TOKEN` env var → `TursoStore` (embedded replica) wrapped in `Result<App>`.
- Sync enabled but credentials missing or TursoStore construction fails → `err(STORE_ERROR)`. **No silent fallback** to SQLiteStore — offline writes must not land only-local.

**Import style (monorepo)** — path aliases `@core/*`, `@store/*`, `@service/*`, `@adapters/*` are retired. Cross-package imports use `@lore/core` (resolved via Bun workspaces). Intra-package imports within `packages/lore/` use relative `.js` paths. No `resolve.alias` in vitest.

**`@lore/core` is browser-safe; Node-only IO lives in `@lore/core/node`** — the default barrel must never top-level-import Node builtins (`fs`/`path`/`os`): the dashboard imports it and Vite's dev-mode stub throws at module-load time (blank SPA). File-IO implementations (`loadConfig`/`saveConfig`, `JsonlTelemetry`/`createTelemetry`) are exported only from the `@lore/core/node` subpath, imported by server code (`packages/lore/**`, `scripts/**`) — never by `packages/dashboard/src/**`. Regression oracle: the Playwright e2e suite (`cd packages/dashboard && bunx playwright test`).

**DocRecord has two identifier fields**: `id` (ULID, immutable PK) and `slug` (human-readable, editable, format `{type}-{kebab-title}`). Service methods accept either via `corpusService.resolve(idOrSlug)` (helper in `src/service/resolve.ts`).

**`bun:sqlite` is external to vitest** — `vitest.config.ts` marks `bun:sqlite` as an SSR external and excludes it from `optimizeDeps`. Tests that touch `SQLiteStore` must use `bun test`, not vitest. CLI loader (`src/adapters/cli/loader.ts`) is bun-only to isolate `bun:sqlite` from vitest-reachable utility modules.

**FTS5 query escaping (`escapeFtsQuery` in `store-shared.ts`)** — user search input is wrapped per whitespace-piece in `"…"` phrase quotes, with internal `"` escaped to `""`. Neutralises FTS5 operators (`-`, `()`, `*`, `OR`, `AND`, `NOT`, `:`). Empty input → short-circuit, never reaches FTS5 MATCH.

### Service Layer (`packages/lore/src/service/`)

| Service | Responsibility |
|---|---|
| `CorpusService` | CRUD, list, search, tree, link/unlink, status |
| `ReviewService` | Pending queue, approve, reject (status transitions) |
| `VersionService` | Version log, unified diff (`diff` pkg), restore (append-only, non-destructive) |
| `OutlineService` | MDX placeholder resolution — regex extracts `<ComponentName ... />` tags, queries store |
| `MigrationService` | One-shot v1→v2 import: parse YAML frontmatter MD files, map types, insert docs + links |
| `TreeCheckService` | Tree-structure drift detection, auto-fix, parent_id ↔ link-table reconciliation |

All services are stateless — state lives entirely in `StoreInterface`. Telemetry is wired in `CorpusService` only (see `packages/core/src/telemetry.ts`, opt-in via config).

### Document Lifecycle

Status transitions (`packages/core/src/schemas.ts → VALID_TRANSITIONS`):

```
draft → in-review → approved → active → archived
draft → approved (fast-track)
approved → deprecated
active → archived | deprecated
```

Editing content/title on an `approved` doc resets it to `draft` automatically.

### MDX Placeholder Components (OutlineService)

Whitelisted components resolved at read time: `ChildrenOf`, `RecentDecisions`, `ActivePlans`, `ModuleTree`, `RelatedOf`, `Embed`, `HealthStats`. Unknown components are stripped with a warning (not an error).

### Type-specific Validation (CreateDocInput)

- `spec` and `task` require `parent_id`
- `adr` requires `extra.decision_status` (`proposed | accepted | deprecated | superseded`)
- `knowledge` requires `extra.sub_type` (`ideation | retro | research | reference`)
- `task` requires `extra.plan_id`

Enforced via Zod `superRefine` in `packages/core/src/schemas.ts`.

## Specs

The corpus is the ONLY spec index — resolve by ordinal (`lore get SPEC-0NN`), full-text search (`lore search "<topic>"`), enumeration (`lore list --type spec`), or grep the exported mirrors under `docs/requirements/spec/`. When implementing or changing behaviour in a module, read the governing spec first.

⛔ Pointer-only section (per `adr-claude-md-specs-section-is-pointer-only-per-spec-index`): NO per-spec index lines here, ever — spec close-outs write NOTHING to this file. The retired 73-line index is reconstructible from the corpus and preserved in git history.

## AI Default Behavior by Caller Surface (SPEC-024)

Lore detects which "caller surface" is invoking it and selects a sensible AI default:

| Surface | How Detected | AI Default | Why |
|---|---|---|---|
| `cli` | None of the agent signals below | **on** | Human in a terminal — SPEC-017 default preserved |
| `agent` | `CLAUDECODE=1` or `CI=true` or `LORE_AI_DEFAULT=off` | **off** | AI-invoked; skip claude-on-claude nesting |
| `mcp` | In-process flag set by `startMcpServer()` | **off** | MCP callers are always AI agents |
| `http_cookie` | Cookie session from `lore dashboard` | **on** | Human browser session |
| `http_token` | Bearer API token | **off** | Agent-issued token |

AI agents using the Lore CLI should export one of `CLAUDECODE=1` / `CI=true` / `LORE_AI_DEFAULT=off` so `lore create` never triggers a nested Claude call. Override per call with `--ai` / `--no-ai` (mutually exclusive; both → exit 2), or per surface via `ai.default_per_surface.<surface>` in `.lore/config.yaml`. `lore status --json` exposes the resolved `ai_defaults`.

## Implementation Status

Phase 1 (core + CLI + service layer) and Phase 2 (MCP, HTTP, Turso sync, telemetry, tree conformance, eval) are landed; active work is incremental hardening. Full mechanism subsections are archived verbatim in `docs/claude-md-archive/spec-implementation-notes.md` (§Implementation Status); per-spec SSOT via `lore get <spec-slug>`. Operational essentials:

- **Service-layer gate enforcement is ON by default** — `GateEnforcer` runs the same `checkpointRegistry` predicates as `lore gate` inside `CorpusService.create`/`set`, `ReviewService.approve`, `TaskWorkflowService.claim` — so CLI, MCP, and HTTP dashboard writes are gated identically. Per-checkpoint knob: `workflow.gates.<checkpoint>.enabled: false`. Optional DI: bare `new CorpusService(store)` test constructions stay ungated.
- **Plan phases (SPEC-023)**: `lore phase add/list/rm/rename <plan>`, `lore create task --phase`, `lore tree` groups by phase; `extra.phase` is validated against the parent plan's `extra.phases[]` at write time (unknown → `VALIDATION_ERROR`).
- **Task workflow (SPEC-025)**: `extra.verification_evidence` (append-only, max 50 entries, `output_tail` ≤ 4000) + `extra.claim` advisory lease (expiry computed read-side vs `workflow.claim_ttl_minutes`, default 120; no daemon) — both owned exclusively by `TaskWorkflowService`, never `CorpusService`. `lore claim` (foreign fresh claim → exit 5 `CLAIM_CONFLICT` unless `--steal`; `--worktree` ALWAYS explicit) / `lore release` (non-holder needs `--force`) / `lore evidence` / `lore ready` (computed over `blocks` links, never stored) / `lore done` (evidence-validated atomic `VALID_TRANSITIONS` walk to `archived`, one audited step at a time; idempotent no-op once terminal — spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3). Actor resolution: `--by` > `$LORE_ACTOR` > OS username; MCP tools require `by` explicitly.
- **Sessions + file anchors (SPEC-042)**: a "session" is DERIVED, never stored — fresh claims grouped by `(by, machine, worktree)`; surfaced via `lore ready` (`sessions[]`/`anchor_conflicts[]`) and `lore bootstrap` (`active_sessions`). `extra.file_anchors` authored via `lore create task --anchor` / `lore anchor add|rm|list` — deliberately NO `lore set --anchor` (`set` replaces `extra` wholesale). The `noAnchorOverlap` gate predicate runs UNCONDITIONALLY; it is only as strong as actor discipline: concurrent dispatchers MUST assign each agent a distinct `LORE_ACTOR=agent:<branch-or-slug>` (all falling to the same OS username → the gate never fires), and claims are made BY THE IMPLEMENTER from inside its own worktree, never by the orchestrator on its behalf. Undeclared anchors are invisible to the gate — manual intersection queueing stays as defense-in-depth.
- **Invalidation (SPEC-043)**: `ValidityService.invalidate` is the SOLE validity writer (`CorpusService.set` rejects validity patches, naming `lore invalidate`); list/search reads filter invalidated docs by default (`--include-invalid` restores, badged), direct-address reads (get/feed/tree/export) ALWAYS show the banner instead; `--supersedes` half-failure is LOUD with the exact repair command.
- **Staleness probes (SPEC-044)** are on-demand, report-only (never auto-invalidate); **`lore assess` (SPEC-026)** has no non-AI mode and one corrective JSON retry — details in the archive.

The v1 predecessor at `/Users/apple/.claude/docman-mcp` remains frozen. Do not carry over its schema or API shape — v2 is greenfield.

<!-- auto:module-index -->
## Module Index

Module-specific context lives alongside the code:

- [`@lore/core`](packages/core/src/CLAUDE.md) — types, Result/LoreError, Zod schemas, lifecycle rules, config, telemetry
- [`packages/lore/src/service`](packages/lore/src/service/CLAUDE.md) — six stateless services, all return `Promise<Result<T, LoreError>>`
- [`packages/lore/src/store`](packages/lore/src/store/CLAUDE.md) — async StoreInterface + SQLite / Turso / InMemory + FTS5 escape
- [`packages/lore/src/adapters/cli`](packages/lore/src/adapters/cli/CLAUDE.md) — citty CLI, 22 subcommands, exit-code mapping
- [`packages/lore/src/adapters/mcp`](packages/lore/src/adapters/mcp/CLAUDE.md) — MCP stdio server, 16 `lore_*` tools, fast-path registration
- [`packages/lore/src/adapters/http`](packages/lore/src/adapters/http/CLAUDE.md) — Bun.serve API, bearer-token auth, sync-push
- [`packages/lore/src/eval`](packages/lore/src/eval/CLAUDE.md) — six read-only evaluation scenarios under `lore eval`
- [`@lore/dashboard`](packages/dashboard/CLAUDE.md) — Vite + React + shadcn local-dev web UI (read views + SPEC-022 write surface)
<!-- /auto:module-index -->

<!-- auto:dynamic-context -->
## Finding Live Project State

Lore is itself the knowledge store — query it through its own CLI rather than reading docs by path:

- `lore search <query>` — FTS5 full-text search over the corpus
- `lore get <id-or-slug>` — read a document (add `--resolve-mdx` to expand placeholders)
- `lore list --type <type>` — filter docs by type (`prd | spec | adr | plan | knowledge | task`)
- `lore tree` — view the document hierarchy (root → specs → tasks)
- `lore pending` — list docs awaiting review
- `lore log <id-or-slug>` — version history; `lore diff <id> --from N --to M` for unified diff
- `lore status` — corpus-level health snapshot
<!-- /auto:dynamic-context -->
