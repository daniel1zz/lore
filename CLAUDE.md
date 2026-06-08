# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Lore** — AI-native shared knowledge/memory platform for AI-first teams (3-5 people + multiple AI agents). Single CLI binary (`lore`) backed by SQLite via `bun:sqlite`. Delivers typed, navigable corpus of PRDs, specs, ADRs, plans, and knowledge, with MDX placeholder resolution, version history, review workflow, and v1 migration.

## Commands

```bash
bun run dev               # Run from source (src/index.ts)
bun run build             # Compile to dist/lore binary (bun build --compile)
bun run typecheck         # tsc --noEmit (strict)

# Tests — two runners, both must pass
bun run test:vitest       # bunx vitest run — covers non-bun:sqlite files
bun run test:bun          # bun test ./tests/ — covers SQLiteStore + bun:sqlite tests
bun run test              # both runners in sequence

# Run a single vitest test file
bunx vitest run tests/unit/service/corpus-service.test.ts

# Run a single bun test file
bun test tests/unit/store/sqlite-store.bun.test.ts
```

**Test file convention**: Files ending in `.bun.test.ts` run under `bun test` only (they use `bun:sqlite`). All other `.test.ts` files run under vitest. Do not mix runners.

## Architecture

### Layer Stack

```
src/adapters/cli/        ← citty CLI (thin adapter, no business logic)
src/app.ts               ← composition root: createApp(dbPath) → App
src/service/             ← business logic, all return Result<T, LoreError>
src/store/               ← storage abstraction (StoreInterface)
src/core/                ← types, errors, schemas (Zod)
```

### Key Design Decisions

**Result<T, LoreError>** — no exceptions cross service boundaries. Every service method returns `{ ok: true; value: T } | { ok: false; error: LoreError }`. Use `ok()` and `err()` helpers from `src/core/errors.ts`.

**StoreInterface** is synchronous — `bun:sqlite` is synchronous. `SQLiteStore` implements it for production; `InMemoryStore` implements it for unit tests. Services depend on `StoreInterface`, never on a concrete store.

**Path aliases** — `tsconfig.json` defines `@core/*`, `@store/*`, `@service/*`, `@adapters/*`. Both are available in source and test files via vitest's `resolve.alias`.

**DocRecord** has two identifier fields: `id` (ULID, immutable PK) and `slug` (human-readable, editable, format: `{type}-{kebab-title}`). Service methods accept either via `corpusService.resolve(idOrSlug)`.

**`bun:sqlite` is external to vitest** — `vitest.config.ts` marks `bun:sqlite` as an SSR external and excludes it from `optimizeDeps`. Tests that touch `SQLiteStore` must use `bun test`, not vitest.

### Service Layer (`src/service/`)

| Service | Responsibility |
|---|---|
| `CorpusService` | CRUD, list, search, tree, link/unlink, status |
| `ReviewService` | Pending queue, approve, reject (status transitions) |
| `VersionService` | Version log, unified diff (`diff` pkg), restore (append-only, non-destructive) |
| `OutlineService` | MDX placeholder resolution — regex extracts `<ComponentName ... />` tags, queries store |
| `MigrationService` | One-shot v1→v2 import: parse YAML frontmatter MD files, map types, insert docs + links |

All services are stateless — state lives entirely in `StoreInterface`.

### Document Lifecycle

Status transitions (`src/core/schemas.ts → VALID_TRANSITIONS`):
```
draft → in-review → approved → active → archived
draft → approved (fast-track)
approved → deprecated
```
Editing content/title on an `approved` doc resets it to `draft` automatically.

### MDX Placeholder Components (OutlineService)

Whitelisted components resolved at read time: `ChildrenOf`, `RecentDecisions`, `ActivePlans`, `ModuleTree`, `RelatedOf`, `Embed`, `HealthStats`. Unknown components are stripped with a warning (not an error).

### Type-specific Validation (CreateDocInput)

- `spec` and `task` require `parent_id`
- `adr` requires `extra.decision_status`
- `knowledge` requires `extra.sub_type`
- `task` requires `extra.plan_id`

Enforced via Zod `superRefine` in `src/core/schemas.ts`.

## Specs

All feature specs live under `docs/requirements/spec/`:
- `SPEC-001` — service layer + DI pattern
- `SPEC-002` — corpus schema, types, lifecycle
- `SPEC-003` — CLI adapter (22 commands, exit codes, output format)
- `SPEC-004` — PRD-as-living-root (MDX placeholders)
- `SPEC-005` — review workflow
- `SPEC-006` — version history
- `SPEC-007` — v1 migration

When implementing a task, read the relevant spec before writing code.

## Implementation Status

Phase 1 is underway. Core layers (`src/core/`, `src/store/`, `src/service/`) are implemented and tested. The CLI adapter (`src/adapters/cli/`) and composition root (`src/app.ts`) are the current implementation target (Tasks C.1 + C.4).

The v1 predecessor at `/Users/apple/.claude/docman-mcp` remains frozen. Do not carry over its schema or API shape — v2 is greenfield.
