---
id: SPEC-014
type: spec
role: spec
title: "Monorepo Skeleton (Bun workspaces, P1 layout)"
status: deprecated
priority: medium
created: 2026-06-28
updated: 2026-10-10
tags: []
---
# SPEC-014: Monorepo Skeleton

## 1. Purpose

Convert the current single-package Lore repository into a Bun-workspaces monorepo with three packages — `@lore/core`, `@lore/lore`, and `@lore/dashboard` (slot). **This is a structural refactor only**: no behaviour changes, no new features, no UI work, no runtime substitution. It creates a stable container for future sub-projects (Dashboard, AI provider, Auth, Write UI) so each can land in its own package without re-litigating the layout.

## 2. Goals & Non-Goals

### 2.1 Goals

- Split `src/` into two source packages and one placeholder, with `@lore/core` exposing pure (zero-IO, zero-runtime-service) primitives reusable by future packages (notably the upcoming Dashboard).
- Preserve **every existing capability**: Bun runtime, `bun:sqlite` storage, `Bun.serve` HTTP, `bun test` runner, `bun build --compile → dist/lore` single binary.
- Preserve **every existing test** (vitest + bun test) and oracle (typecheck) — full green at end of migration.
- Preserve git history via `git mv` for every relocated file.
- Establish package boundary conventions that future sub-projects (`@lore/dashboard`, `@lore/ai-providers`, etc.) can follow without redesigning.

### 2.2 Non-Goals (explicit)

- ❌ Dashboard implementation — `@lore/dashboard` is a placeholder package with README + minimal `package.json`; no Vite, no React, no shadcn.
- ❌ AI provider integration.
- ❌ Cookie auth or session store.
- ❌ Write-path UI / forms.
- ❌ Turso sync end-to-end work.
- ❌ Replacing `bun:sqlite`, switching runtime, or any Node.js compatibility work.
- ❌ npm publishing — every `package.json` is `private: true`.
- ❌ Splitting `service`, `store`, or `adapters` into their own packages. They stay co-located under `packages/lore/src/`. (Future SPEC may revisit.)

## 3. Architecture

### 3.1 Final layout

```
lore/                                  ← repo root
├── package.json                       ← workspaces config + fan-out scripts
├── bunfig.toml                        ← Bun workspaces options (unchanged keys preserved)
├── tsconfig.base.json                 ← shared strict TS config + module resolution
├── tsconfig.json                      ← root: composite project references
├── vitest.config.ts                   ← root: aggregates per-package tests
├── docs/                              ← unchanged: PRD / spec / ADR source
├── .lore/                             ← unchanged: lore.db + config.yaml
├── .claude/                           ← unchanged: hooks / agents / skills
├── .gitignore                         ← updated: ignore packages/*/node_modules etc.
└── packages/
    ├── core/                          ← @lore/core (pure)
    │   ├── package.json               ← { name, type: module, main: "src/index.ts", private: true }
    │   ├── tsconfig.json              ← extends ../../tsconfig.base.json
    │   └── src/
    │       ├── index.ts               ← public re-exports
    │       ├── errors.ts
    │       ├── types.ts
    │       ├── schemas.ts
    │       ├── config.ts
    │       ├── telemetry.ts
    │       └── graph-utils.ts
    │
    ├── lore/                          ← @lore/lore (CLI/MCP/HTTP runtime)
    │   ├── package.json               ← { name, bin: { lore: "src/index.ts" }, dependencies: { "@lore/core": "workspace:*" }, private: true }
    │   ├── tsconfig.json              ← extends + references @lore/core
    │   ├── src/
    │   │   ├── index.ts               ← entry (CLI vs --mcp-server routing)
    │   │   ├── app.ts                 ← composition root
    │   │   ├── adapters/
    │   │   │   ├── cli/               ← citty CLI (22 subcommands)
    │   │   │   ├── mcp/               ← MCP stdio server
    │   │   │   └── http/              ← Bun.serve API + sync-push
    │   │   ├── service/               ← six stateless services
    │   │   ├── store/                 ← StoreInterface + SQLite/Turso/InMemory
    │   │   └── eval/                  ← read-only eval scenarios
    │   └── tests/                     ← migrated wholesale from root tests/
    │       ├── unit/
    │       ├── integration/
    │       └── e2e/
    │
    └── dashboard/                     ← @lore/dashboard (slot only)
        ├── package.json               ← { name, private: true, scripts: {} placeholder }
        └── README.md                  ← "Reserved for future Vite + React + shadcn SPA"
```

### 3.2 `@lore/core` boundary

**Belongs in `@lore/core` (pure / zero-IO):**

- `errors.ts` — `LoreError` discriminated union, `ok()`, `err()`, `Result<T, E>` types.
- `types.ts` — `DocRecord`, `DocType`, `Status`, `Priority`, `LinkType`, etc.
- `schemas.ts` — Zod schemas + `VALID_TRANSITIONS`.
- `config.ts` — `LoreConfigSchema`, `GlobalLoreConfigSchema`, pure parse helpers, `resolveGlobalConfigPath`, `loadGlobalConfig`, `mergeDefaults`. (File I/O helpers stay — they only depend on `node:fs`/`node:os`/`node:path`, no business state.)
- `telemetry.ts` — config schemas + `NoOpTelemetry` (the no-op). `JsonlTelemetry` (which writes files) is acceptable here as long as it only uses `node:fs` and never depends on `service/`/`store/`.
- `graph-utils.ts` — pure graph helpers (cycle detection, etc.).

**Stays in `@lore/lore` (IO / runtime):**

- `app.ts` — composition root.
- All `service/*.ts` — stateful business logic.
- All `store/*.ts` — wraps `bun:sqlite` / `@libsql/client`.
- All `adapters/{cli,mcp,http}/*` — transport layers.
- All `eval/*.ts` — read services to run scenarios.

**Rule**: `@lore/core` MUST NOT import from `@lore/lore`. `@lore/lore` MAY import from `@lore/core`.

### 3.3 Workspace dependency declaration

`packages/lore/package.json`:

```json
{
  "name": "@lore/lore",
  "private": true,
  "type": "module",
  "bin": { "lore": "src/index.ts" },
  "dependencies": {
    "@lore/core": "workspace:*",
    "@libsql/client": "...",
    "citty": "...",
    "yaml": "...",
    "zod": "...",
    "diff": "...",
    "@modelcontextprotocol/sdk": "..."
  }
}
```

`packages/core/package.json`:

```json
{
  "name": "@lore/core",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "dependencies": { "zod": "..." }
}
```

`packages/dashboard/package.json`:

```json
{
  "name": "@lore/dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "echo 'dashboard slot — implementation pending in SPEC-NNN'; exit 1",
    "build": "echo 'dashboard slot — implementation pending in SPEC-NNN'; exit 1"
  }
}
```

Root `package.json`:

```json
{
  "name": "lore-workspace",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "bun run --filter '@lore/lore' dev",
    "build": "bun run --filter '@lore/lore' build",
    "typecheck": "tsc --build",
    "test": "bun run test:vitest && bun run test:bun",
    "test:vitest": "vitest run",
    "test:bun": "cd packages/lore && bun test .bun.test"
  }
}
```

### 3.4 TypeScript: project references

`tsconfig.base.json` (new — shared strict config):

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true
  }
}
```

`packages/core/tsconfig.json`:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "rootDir": "src" },
  "include": ["src/**/*"]
}
```

`packages/lore/tsconfig.json`:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "rootDir": "src" },
  "include": ["src/**/*"],
  "references": [{ "path": "../core" }]
}
```

Root `tsconfig.json`:

```jsonc
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./packages/lore" }
  ]
}
```

Tests use a separate `tsconfig.tests.json` per package (or root) — unchanged pattern from today.

### 3.5 Path alias retirement

Today: `tsconfig.json` defines `@core/*`, `@store/*`, `@service/*`, `@adapters/*` — used in ~50 import sites.

After: **all four aliases removed.** Imports rewrite as follows:

| Today | After migration |
|---|---|
| `import { ok } from "@core/errors"` | `import { ok } from "@lore/core"` (re-exported from `@lore/core/src/index.ts`) |
| `import { CorpusService } from "@service/corpus-service"` | `import { CorpusService } from "../service/corpus-service.js"` (intra-package relative) |
| `import { SQLiteStore } from "@store/sqlite-store"` | `import { SQLiteStore } from "../store/sqlite-store.js"` (intra-package relative) |
| `import ... from "@adapters/cli/utils"` | `import ... from "../utils.js"` etc. (intra-package relative) |

**Rule**: cross-package imports use the npm package name (`@lore/core`); intra-package imports use relative paths with `.js` extension (existing convention preserved).

Tests follow the same rule. Existing `vitest.config.ts` `resolve.alias` block is removed — workspace resolution replaces it.

### 3.6 Build pipeline

CLI binary build entry:

- Before: `bun build --compile src/index.ts --outfile dist/lore`
- After: `bun build --compile packages/lore/src/index.ts --outfile dist/lore`

`@lore/core` is **not** built — it is consumed as TypeScript source by `@lore/lore`. Bun resolves the workspace symlink and reads `.ts` directly. (When/if we later add npm publish for `@lore/core`, this SPEC will be amended; today it is intentionally out of scope.)

### 3.7 Test pipeline

- `bun run test:vitest` (root): runs `vitest` from repo root. Vitest config picks up `packages/*/tests/**/*.test.ts` (vitest discovers per-package configs if present, but P1 keeps a single root `vitest.config.ts`).
- `bun run test:bun` (root): `cd packages/lore && bun test .bun.test` — bun test only globs the `lore` package since that's where `bun:sqlite` lives. `@lore/core` has no `bun:sqlite` tests.

Two-runner convention is **preserved unchanged**.

### 3.8 `.lore/`, `docs/`, `.claude/` location

Stay at repo root. They are project-level metadata, not workspace packages. `findLoreDbPath()` already walks upward from `cwd` — works unchanged in monorepo subdirs.

## 4. Migration Plan

Numbered for plan/task decomposition.

1. **M1 — Scaffolding**: create `packages/{core,lore,dashboard}/` dirs. Write `tsconfig.base.json`. Write each package's `package.json` + `tsconfig.json`. Write root `tsconfig.json` with project references. Update root `package.json` workspaces field + fan-out scripts.

2. **M2 — Core relocation**: `git mv src/core/* packages/core/src/`. Write `packages/core/src/index.ts` with explicit re-exports (errors, types, schemas, config, telemetry, graph-utils).

3. **M3 — Lore relocation**: `git mv src/{adapters,service,store,eval} packages/lore/src/`; `git mv src/{app,index}.ts packages/lore/src/`. Delete now-empty `src/`.

4. **M4 — Tests relocation**: `git mv tests packages/lore/tests`. Update any test paths in `vitest.config.ts` (root) and `bun test` script.

5. **M5 — Path alias rewrite**: codemod removes `@core/*`, `@service/*`, `@store/*`, `@adapters/*`. `@core/*` → `@lore/core` (npm-name); the other three → intra-package relative paths with `.js` extension. (Subagent task. Current sites: 114 `from "@(core|service|store|adapters)/..."` imports across `src/` + `tests/`, verified by `grep -rE 'from "@(core|service|store|adapters)/' src/ tests/ | wc -l`.)

6. **M6 — Config rewrites**: update `vitest.config.ts` (drop alias; update `include` to `packages/**/*.test.ts`); update `bunfig.toml` if it referenced `src/`; update `.gitignore` for `packages/*/node_modules`.

7. **M7 — Build entry**: update `package.json` `build` script + any CI yaml to point at `packages/lore/src/index.ts`.

8. **M8 — Dashboard slot**: write `packages/dashboard/package.json` + `README.md` (no source files).

9. **M9 — Documentation sync**: update root `CLAUDE.md` (layer stack section) + each module's `CLAUDE.md` to reflect new paths. Update SPEC-001 §intro reference, SPEC-003 §intro (if it cites `src/adapters/cli`).

10. **M10 — Oracle gate**: `bun install` (re-link workspaces) → `bun typecheck` → `bun test` (both runners). All green = success criterion AC-MR-1.

Order matters: M1 → M2 → M3 → M4 → M5 in sequence (each depends on prior); M6/M7 can be parallel after M5; M8 can run any time after M1; M9/M10 last.

## 5. Acceptance Criteria

### 5.1 Structural

- `AC-MR-S1`: Repo root contains `packages/core/`, `packages/lore/`, `packages/dashboard/`. No `src/` or `tests/` at repo root.
- `AC-MR-S2`: `packages/core/package.json` declares `name: "@lore/core"`, `private: true`.
- `AC-MR-S3`: `packages/lore/package.json` declares `name: "@lore/lore"`, `private: true`, `bin: { lore: "src/index.ts" }`, depends on `"@lore/core": "workspace:*"`.
- `AC-MR-S4`: `packages/dashboard/package.json` declares `name: "@lore/dashboard"`, `private: true`; package contains no `src/` directory.
- `AC-MR-S5`: Root `package.json` declares `"workspaces": ["packages/*"]`.
- `AC-MR-S6`: `tsconfig.base.json` exists at repo root; both source packages extend it via `"extends": "../../tsconfig.base.json"`.

### 5.2 Boundary

- `AC-MR-B1`: `grep -r "from \"@lore/lore\"" packages/core/src/` returns zero hits (no upstream import).
- `AC-MR-B2`: `grep -r "@core\\|@service\\|@store\\|@adapters" packages/` returns zero hits (all aliases retired).
- `AC-MR-B3`: All cross-package imports use `@lore/core` (npm-name form). All intra-package imports use relative paths with `.js` extension.

### 5.3 Oracle

- `AC-MR-O1`: `bun typecheck` exits 0 with no errors.
- `AC-MR-O2`: `bun run test:vitest` passes the same count as before migration (currently 954 tests).
- `AC-MR-O3`: `bun run test:bun` passes the same count as before migration (currently 388 tests).
- `AC-MR-O4`: `bun run build` produces a runnable `dist/lore` binary; `dist/lore status` in a project with `.lore/lore.db` returns exit 0 and prints corpus stats (smoke test).

### 5.4 Git hygiene

- `AC-MR-G1`: `git log --follow packages/core/src/errors.ts` shows the original history from `src/core/errors.ts` (history preserved via `git mv`).
- `AC-MR-G2`: Migration lands as a single semantic series of commits (M1..M10 ≈ 1 commit per milestone, or grouped logically); each commit individually compiles or is explicitly marked WIP.

## 6. Out-of-scope rejections

Any of the following requests during implementation MUST be deferred to a future SPEC and NOT silently bundled in:

- Splitting `service`/`store`/`adapters` into separate packages.
- Adding any Dashboard source code beyond `README.md` placeholder.
- Introducing `tsup` / `tsc --build` artifact generation for `@lore/core`.
- Switching test runner.
- Replacing `bun:sqlite`.
- Adding `pnpm` / `npm` / `yarn` lockfiles.
- Removing `bun build --compile`.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `bun build --compile` behaviour change in workspace context (entry resolution) | M10 smoke test produces runnable binary; if it fails, document the change in this SPEC and adjust before declaring done |
| Path alias codemod miss-rewrites a string in comments / templates | typecheck catches missed imports; grep-based AC-MR-B2 catches alias leakage |
| `bun:sqlite` resolution breaks under workspace symlink (unlikely — it's a Bun built-in module, not workspace package) | Existing `bun:sqlite` tests in M10 will fail loudly if so |
| Vitest config aggregation across packages | P1 keeps a single root `vitest.config.ts` — fan-out lives there. If per-package configs become necessary later, add in a follow-up SPEC |
| `findLoreDbPath()` walks above the package dir (cwd is `packages/lore/`) | Walk is `cwd → root`; `.lore/` at repo root is still found. No change needed |
| `loadConfig` looks for `.lore/config.yaml` relative to a project dir | Logic unchanged; project dir is still the repo root for users running `lore` from the workspace |

## 8. Open Questions (deliberately none)

All material decisions were grilled during brainstorming and locked. If a new question surfaces during implementation, raise it as an addendum at the bottom of this section rather than silently choosing.
