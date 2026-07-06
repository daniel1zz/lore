# Module: adapters/cli

## Purpose

citty-based CLI adapter. 25 subcommands, each in its own `commands/<name>.ts`, lazily imported by `index.ts`. Thin adapter only — no business logic; every command resolves args, calls a service via the App composition root, formats the result, and exits.

## Key Invariants

- **No business logic.** Commands resolve args → call `app.<service>.<method>()` → render output → map error to exit code. New rules belong in `packages/lore/src/service`, not here.
- **DB discovery + App construction live in `loader.ts`, not `utils.ts`.** `loader.ts` imports `bun:sqlite` (via `app.ts`); `utils.ts` is vitest-reachable and must stay sqlite-free. Commands that need an App import `loadLoreApp` from `loader.ts`; commands that only format errors import from `utils.ts`.
- **`loadLoreApp()` always returns `App` (never `Result<App>`).** It strips `config.sync` before passing to `createApp`, so corpus-level commands never hit the TursoStore-failure path. Sync-aware commands (`lore sync ...`) manage TursoStore themselves.
- **`init` and `sync` commands bypass `loadLoreApp`** — `init` runs before a DB exists; `sync` manages TursoStore directly. Document the exemption when adding a new bootstrap-stage command.
- **Telemetry must be wired (AC-K3-1)** — `loadLoreApp` always parses `.lore/config.yaml` (failures fall back to `NoOpTelemetry`) so user telemetry preferences apply to every command. Don't call `createApp(dbPath)` directly from a command.
- **Exit codes per SPEC-003 §5** — mapping is centralised in `utils.ts::exitCode`. `1 = STORE_ERROR / unknown`, `3 = DOC_NOT_FOUND | SLUG_NOT_FOUND`, `4 = validation / lifecycle / link errors`, `5 = STALE_VERSION | CLAIM_CONFLICT`. The default branch uses an exhaustive `never` check; add new `LoreError` codes here too.
- **Actor resolution for workflow commands (SPEC-025)** — `claim` / `release` / `evidence` resolve the acting identity via `utils.ts::resolveActor`: `--by` flag > `$LORE_ACTOR` env var > OS username. Never silently falls back to an empty string.
- **Implicit calibration capture (SPEC-035 §3)** — `approve` / `reject` call the shared `../calibration-hook.ts::runCalibrationHook` after their `ReviewService` call succeeds. It is a byproduct, never a gate: a calibration write failure prints a stderr warning + records telemetry but never changes the command's exit code (still 0). `calibration-hook.ts` takes a narrowed `{judgmentService, telemetry}` dependency shape (not the full `App`) so it stays unit-testable without a real store.

## Patterns

- **Subcommands are lazy ES module imports** — `index.ts` defines `subCommands: { create: () => import("./commands/create.js").then(m => m.default) }`. Keeps cold-start cheap; each command file's deps are not loaded unless invoked.
- **`findLoreDbPath` walks `cwd` → root** looking for `.lore/lore.db`. Exits with code 1 + `lore init` hint when absent.
- **Output helpers in `utils.ts`** — `formatTable`, `formatTree` (Unicode box drawing), `formatNavigation`, `relativeTime`. Pure; no `process.exit` calls. Reusable from tests.
- **Hyphen-quoted error mode** — `formatError` produces multi-line stderr output with contextual hints (`"Run \`lore get <id>\`..."`). Add a new case when introducing a new `LoreError` code.

## Subcommands

`init` `create` `get` `set` `delete` `list` `search` `tree` `link` `unlink` `pending` `approve` `reject` `log` `diff` `restore` `migrate` `status` `serve` `agent` `sync` `eval` `dashboard` `sync-docs` `export-docs` `phase` `claim` `release` `evidence` `ready` `assess` `audit` `calibration`

`audit` (SPEC-035) — `lore audit [<doc>] [--actor] [--action] [--since] [--limit] [--json]` queries the audit table (filters map 1:1 to `AuditFilters`); `lore audit --verify [--since] [--json]` runs the versions⋈audit completeness oracle (exit 0 clean, exit 4 with itemized misses). AI-judge actors (`ai:{provider}:{model}:{prompt_version}`, SPEC-034 §2) are decoded via `parseAuditActor` for human-readable output.

`calibration` (SPEC-035 §4) — `lore calibration --stats [--doc-type <type>] [--prompt-version <v>] [--json]`: read-only table of `{n, agreement_rate, wilson_lower_bound, window_limit}` per (doc_type × prompt_version), thin pipe over `JudgmentService.computeCalibrationStats`. `--stats` is required (only mode currently); omitting it exits 2.

`sync-docs` (SPEC-018) scans a directory of `*.md` spec files, creates corpus rows for missing specs matched by title, and reports body drift without auto-applying. Flags: `--from <path>` (scan dir), `--dry-run` (no writes), `--json` (machine-readable SyncReport).

`claim` / `release` / `evidence` / `ready` (SPEC-025) — task execution workflow: `lore claim <task> [--by] [--branch] [--steal]` acquires an advisory lease; `lore release <task> [--by] [--reason] [--force]` clears it; `lore evidence <task> --oracle <kind> --command <cmd> --result <pass|fail> [--output-tail | --output-tail-file] [--by]` appends an oracle verification record; `lore ready <plan>` prints the computed readiness report (never stored). `lore tree` / `lore list --type task` render a claim/evidence badge on task rows.

`assess` (SPEC-026) — `lore assess <plan> [--diff <git-range> | --diff-file <path>] [--json] [--ai|--no-ai]`: AI plan-outcome assessment (LLM-as-judge). `--diff` shells `git diff <range>` (via `node:child_process.spawnSync`, mirrors `editor.ts`'s subprocess pattern); `--diff-file` reads pre-generated diff text (mirrors `set.ts`'s `--content-file` hermetic-test-seam idiom); passing both → exit 2. Zero child tasks on the plan → exit 4 (`VALIDATION_ERROR`) BEFORE any AI call. Unlike every other AI mutation command, assess has no non-AI mode — `--no-ai` always exits 2, and the surface's built-in AI-off default (agent/mcp/http_token) does NOT brake it; only an explicit `ai.default_per_surface.<surface> = false` config override does (`isAssessAiBraked`, `../../ai/resolve-ai.js`). On success, persists a `knowledge` doc (`sub_type="assessment"`) linked to the plan via `informs` and prints a verdict + AC score table (or `--json` envelope).

`serve` mounts the HTTP adapter; `agent` manages API keys for AI agents — create/list/revoke (SPEC-010 §3.2), NOT an MCP launcher (MCP is entered via the top-level `--mcp-server` flag only); `eval` runs evaluation scenarios; `dashboard` (SPEC-016) starts the HTTP server in-process, spawns the `@lore/dashboard` Vite dev server, ensures `.lore/local-key` exists, and injects a one-time bootstrap token so the SPA can exchange it for an HttpOnly session cookie.

`serve` mounts the HTTP adapter; `agent` manages API keys for AI agents — create/list/revoke (SPEC-010 §3.2), NOT an MCP launcher (MCP is entered via the top-level `--mcp-server` flag only); `eval` runs evaluation scenarios.

## Links

- Depends on: [`@lore/core`](../../../../../core/src/CLAUDE.md), [`../../service`](../../service/CLAUDE.md), [`../../store`](../../store/CLAUDE.md) (transitively via `../../app.ts`).
- Used by: end users via the compiled `dist/lore` binary; `../../index.ts` is the dispatch entry.
- Mounts: [`../http`](../http/CLAUDE.md) (`lore serve`), [`../mcp`](../mcp/CLAUDE.md) (`lore agent`), [`../../eval`](../../eval/CLAUDE.md) (`lore eval`).
