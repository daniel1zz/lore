# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Lore** — AI-native shared knowledge/memory platform for AI-first teams (3-5 people + multiple AI agents). Single binary (`lore`) with three adapters: citty CLI (default), MCP server (`--mcp-server`), and HTTP server (`lore serve`). Storage is local SQLite via `bun:sqlite` by default; with `sync.enabled` it switches to a Turso embedded replica (`@libsql/client`) for multi-machine visibility. Delivers a typed, navigable corpus of PRDs, specs, ADRs, plans, knowledge, and tasks, with MDX placeholder resolution, version history, review workflow, tree-structure conformance checks, telemetry, and v1 migration.

## Commands

```bash
bun run dev               # Run from source (packages/lore/src/index.ts)
bun run build             # Compile to dist/lore binary (bun build --compile)
bun run typecheck         # tsc --noEmit for all packages + scripts

# Tests — two runners, both must pass
bun run test:vitest       # bunx vitest run — covers non-bun:sqlite files
bun run test:bun          # cd packages/lore && bun test .bun.test
bun run test              # both runners in sequence

# Run a single vitest test file
bunx vitest run packages/lore/tests/unit/service/corpus-service.test.ts

# Run a single bun test file
cd packages/lore && bun test tests/unit/store/sqlite-store.bun.test.ts
```

**Test file convention**: Files ending in `.bun.test.ts` run under `bun test` only (they use `bun:sqlite`). All other `.test.ts` files run under vitest. Do not mix runners.

## Architecture

### Layer Stack

```
packages/lore/src/adapters/cli/   ← citty CLI (default entry, 22 subcommands)
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

All feature specs live under `docs/requirements/spec/`. When implementing or changing behaviour in a module, read the relevant spec first.

- `SPEC-001` — service layer + DI pattern
- `SPEC-002` — corpus schema, types, lifecycle
- `SPEC-003` — CLI adapter (22 commands, exit codes, output format)
- `SPEC-004` — PRD-as-living-root (MDX placeholders)
- `SPEC-005` — review workflow
- `SPEC-006` — version history
- `SPEC-007` — v1 migration
- `SPEC-008` — MCP adapter (16 `lore_*` tools)
- `SPEC-009` — Turso embedded-replica sync (D-007 fail-loud)
- `SPEC-010` — HTTP API + API key auth
- `SPEC-011` — HTTP route layout
- `SPEC-012` — telemetry (JSONL, opt-in)
- `SPEC-013` — FTS5 resilience + eval scenarios
- `SPEC-014` — Monorepo skeleton (Bun workspaces, @lore/core + @lore/lore + @lore/dashboard)
- `SPEC-015` — Dashboard read-only skeleton (Vite + React + shadcn; list/search/tree/detail)
- `SPEC-016` — Cookie auth via CLI-managed local bootstrap (`lore dashboard` + sessions table)
- `SPEC-020` — HTTP-backed AI provider (`ai.provider: "http"`) — Anthropic Messages API; `${ENV_VAR}` headers; for CI/team gateways where local `claude` binary is unavailable; CLI is still the default
- `SPEC-024` — Default --no-ai for agent and MCP execution paths (AI surface defaults)
- `SPEC-019` — AI assistance in `lore set` (`--regenerate` / `--refine` / `--refine-stdin`) and `lore link --infer`; extends SPEC-017 AI provider surface
- `SPEC-021` — `lore export-docs` reverse sync (corpus → .md files); `.lore/export-index.json` is **git-tracked** (team-shared ID map)
- `SPEC-022` — Dashboard write UI (create / edit / approve / link): six cookie-gated `/api/dashboard/*` write routes, CodeMirror 6 editor, If-Match optimistic concurrency + ConflictModal, History tab

## AI Default Behavior by Caller Surface (SPEC-024)

Lore detects which "caller surface" is invoking it and selects a sensible AI default:

| Surface | How Detected | AI Default | Why |
|---|---|---|---|
| `cli` | None of the agent signals below | **on** | Human in a terminal — SPEC-017 default preserved |
| `agent` | `CLAUDECODE=1` or `CI=true` or `LORE_AI_DEFAULT=off` | **off** | AI-invoked; skip claude-on-claude nesting |
| `mcp` | In-process flag set by `startMcpServer()` | **off** | MCP callers are always AI agents |
| `http_cookie` | Cookie session from `lore dashboard` | **on** | Human browser session |
| `http_token` | Bearer API token | **off** | Agent-issued token |

### Env-var Matrix (recommended values for AI agent environments)

If you are an AI agent using the Lore CLI:

```bash
# Recommended: suppress AI by default so lore create never triggers a nested Claude call.
# Any of these three env vars cause surface detection to return "agent":
export CLAUDECODE=1        # Claude Code sets this automatically
export CI=true             # CI runners set this automatically
export LORE_AI_DEFAULT=off # Explicit opt-out for any non-Claude agent
```

### Overriding the Default

```bash
lore create spec --title "My Spec" --ai      # Force AI on (any surface)
lore create spec --title "My Spec" --no-ai  # Force AI off (any surface) → editor
```

`--ai` and `--no-ai` are mutually exclusive; passing both exits with code 2.

Per-surface config override (in `.lore/config.yaml`):
```yaml
ai:
  default_per_surface:
    cli: false       # disable AI even for human terminal
    agent: true      # enable AI for agents (rare)
```

`lore status --json` exposes `ai_defaults: { cli, agent, mcp, http_cookie, http_token }` —
the resolved per-surface AI defaults for the current configuration.

## Implementation Status

Phase 1 (core + CLI + service layer) and Phase 2 (MCP server, HTTP server, Turso sync, telemetry, tree conformance, eval) are landed. Active work focuses on incremental hardening (escape paths, drift fixes, additional scenarios).

### Plan Phases (SPEC-023)

Plans support optional declared phases via `extra.phases: Array<{name, description?}>`. Tasks may reference a phase by name via `extra.phase: string`.

Key patterns:
- `lore phase add <plan> <name> [--description]` — declare a phase on a plan (exit 4 on duplicate)
- `lore phase list <plan>` — list declared phases
- `lore phase rm <plan> <name>` — remove (fails if tasks still reference it)
- `lore phase rename <plan> <old> <new>` — rename in plan + all referencing tasks
- `lore create task --phase <name> ...` — assign task to phase at creation time
- `lore list --type task --plan-id <plan> --phase <name>` — filter tasks by phase
- `lore tree <plan>` — groups tasks under phase headers when plan has phases declared
- `lore migrate phases [--dry-run]` — one-shot sweep: converts legacy singular `extra.phase` → `extra.legacy_phase` across all plan rows (idempotent)

Cross-entity validation: creating or updating a task with `extra.phase` validates the name against the parent plan's `extra.phases[]` at write time (`CorpusService._createImpl` / `set`). Unknown phase or plan with no phases → `VALIDATION_ERROR`.

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
