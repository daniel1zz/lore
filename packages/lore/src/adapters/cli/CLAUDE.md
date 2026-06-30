# Module: adapters/cli

## Purpose

citty-based CLI adapter. 24 subcommands, each in its own `commands/<name>.ts`, lazily imported by `index.ts`. Thin adapter only — no business logic; every command resolves args, calls a service via the App composition root, formats the result, and exits.

## Key Invariants

- **No business logic.** Commands resolve args → call `app.<service>.<method>()` → render output → map error to exit code. New rules belong in `packages/lore/src/service`, not here.
- **DB discovery + App construction live in `loader.ts`, not `utils.ts`.** `loader.ts` imports `bun:sqlite` (via `app.ts`); `utils.ts` is vitest-reachable and must stay sqlite-free. Commands that need an App import `loadLoreApp` from `loader.ts`; commands that only format errors import from `utils.ts`.
- **`loadLoreApp()` always returns `App` (never `Result<App>`).** It strips `config.sync` before passing to `createApp`, so corpus-level commands never hit the TursoStore-failure path. Sync-aware commands (`lore sync ...`) manage TursoStore themselves.
- **`init` and `sync` commands bypass `loadLoreApp`** — `init` runs before a DB exists; `sync` manages TursoStore directly. Document the exemption when adding a new bootstrap-stage command.
- **Telemetry must be wired (AC-K3-1)** — `loadLoreApp` always parses `.lore/config.yaml` (failures fall back to `NoOpTelemetry`) so user telemetry preferences apply to every command. Don't call `createApp(dbPath)` directly from a command.
- **Exit codes per SPEC-003 §5** — mapping is centralised in `utils.ts::exitCode`. `1 = STORE_ERROR / unknown`, `3 = DOC_NOT_FOUND | SLUG_NOT_FOUND`, `4 = validation / lifecycle / link errors`, `5 = STALE_VERSION`. The default branch uses an exhaustive `never` check; add new `LoreError` codes here too.

## Patterns

- **Subcommands are lazy ES module imports** — `index.ts` defines `subCommands: { create: () => import("./commands/create.js").then(m => m.default) }`. Keeps cold-start cheap; each command file's deps are not loaded unless invoked.
- **`findLoreDbPath` walks `cwd` → root** looking for `.lore/lore.db`. Exits with code 1 + `lore init` hint when absent.
- **Output helpers in `utils.ts`** — `formatTable`, `formatTree` (Unicode box drawing), `formatNavigation`, `relativeTime`. Pure; no `process.exit` calls. Reusable from tests.
- **Hyphen-quoted error mode** — `formatError` produces multi-line stderr output with contextual hints (`"Run \`lore get <id>\`..."`). Add a new case when introducing a new `LoreError` code.

## Subcommands (25)

`init` `create` `get` `set` `delete` `list` `search` `tree` `link` `unlink` `pending` `approve` `reject` `log` `diff` `restore` `migrate` `status` `serve` `agent` `sync` `eval` `dashboard` `sync-docs` `phase`

`sync-docs` (SPEC-018) scans a directory of `*.md` spec files, creates corpus rows for missing specs matched by title, and reports body drift without auto-applying. Flags: `--from <path>` (scan dir), `--dry-run` (no writes), `--json` (machine-readable SyncReport).

`serve` mounts the HTTP adapter; `agent` manages API keys for AI agents — create/list/revoke (SPEC-010 §3.2), NOT an MCP launcher (MCP is entered via the top-level `--mcp-server` flag only); `eval` runs evaluation scenarios; `dashboard` (SPEC-016) starts the HTTP server in-process, spawns the `@lore/dashboard` Vite dev server, ensures `.lore/local-key` exists, and injects a one-time bootstrap token so the SPA can exchange it for an HttpOnly session cookie.

`serve` mounts the HTTP adapter; `agent` manages API keys for AI agents — create/list/revoke (SPEC-010 §3.2), NOT an MCP launcher (MCP is entered via the top-level `--mcp-server` flag only); `eval` runs evaluation scenarios.

## Links

- Depends on: [`@lore/core`](../../../../../core/src/CLAUDE.md), [`../../service`](../../service/CLAUDE.md), [`../../store`](../../store/CLAUDE.md) (transitively via `../../app.ts`).
- Used by: end users via the compiled `dist/lore` binary; `../../index.ts` is the dispatch entry.
- Mounts: [`../http`](../http/CLAUDE.md) (`lore serve`), [`../mcp`](../mcp/CLAUDE.md) (`lore agent`), [`../../eval`](../../eval/CLAUDE.md) (`lore eval`).
