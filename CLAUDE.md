# CLAUDE.md

⛔ Before hand-editing this file, read its content contract: `lore governance claude-md`. This file is tier 1: rules, each with at most one short scope-setting reason. The reasoning, mechanism notes and standing-lessons index behind every line here: `knowledge-root-claude-md-tier-2-text-verbatim-body-before-the`.

## What This Is

**Lore** — AI-native shared knowledge/memory platform for AI-first teams (3-5 people + many AI agents). One binary, `lore`: citty CLI (default), HTTP server (`lore serve`). Local SQLite (`bun:sqlite`) by default; a Turso embedded replica when `sync.enabled`.

## North Star

Target: development ~100% by AI, one project worked by MANY CONCURRENT SESSIONS, unattended after the opening phase. The corpus is the SSOT and the coordination mechanism, so **corpus integrity outranks code correctness**.

- The corpus must not lie (a verdict carries the state it describes; rendering is injective; labels are honest), must not go silent (filtering leaves a trace in the count; "vacuously true" is distinguishable from "true"), and must be addressable (every assertion locatable and re-verifiable).
- Ask of every change: does it hold with NO human present? What if two sessions do it at once (⛔ an answer relying on exclusivity is a refusal of the target state)? What refuses it when violated ("an agent should remember" = NOT ENFORCED — say so, count it)? What is the smallest mutation that turns its oracle red (`lore ac add --falsifier-*`)?
- ⛔ Self-checking must stay cheaper than corpus growth: prefer incremental, local, concurrency-safe checks over full-suite verdicts.

## Commands

The command table (name, command, description) is generated below from `package.json` `lore.documentedScripts`; invoke each as `bun run <name>`. Edit a description there, then `lore context refresh`.

- ⛔ `test:changed` under- AND over-selects: hand-pick consumers, re-verify on main.
- One runner, vitest: `bun run test:bun` is retired (prints a notice, exits 1). Run a single file with `bun run test:file <path>`.
- ⛔ Never write to the repo's own `.lore/` from tests or smoke checks — use a throwaway corpus (`mkdtemp` + `lore init`). ⛔ Never assume a server on port 8787 is yours.
- Pre-push gate: its checks and their order live in `hooks/pre-push`, never here. ⛔ Every merge to main is followed by `bun run build` (a `dist/lore` older than HEAD is refused), after the batch's last agent returns. After clone: `git config core.hooksPath hooks`.

## Architecture

Repo-wide invariants. Current-state architecture (modules, layers, standards, decisions, debt): the architecture tree, `lore get baseline-lore-architecture` (current state `baseline-architecture-current-state`, standards `baseline-architecture-standards`). The why, the layer stack, the service table and per-module facts are also in module CLAUDE.md files and `knowledge-root-claude-md-tier-2-text-verbatim-body-before-the`.

- **Result<T, LoreError>**: no exception crosses a service boundary; every service method returns `Promise<Result<…>>` built with `ok()` / `err()` from `@lore/core`.
- Services depend on the async `StoreInterface`, never on a concrete store. ⛔ No silent fallback: a missing required input fails loud.
- Imports: cross-package only via `@lore/core`; intra-package relative `.js` paths; the `@core/*`-style aliases are retired.
- ⛔ `@lore/core`'s default barrel never imports a Node builtin; Node IO lives in `@lore/core/node`, which `packages/dashboard/src/**` never imports.
- A doc has `id` (ULID, immutable) and `slug` (editable); services accept either via `corpusService.resolve`.
- Gates run in the service layer, so CLI and HTTP writes are gated identically.
- Lifecycle: `VALID_TRANSITIONS` in `packages/core/src/lifecycle.ts` is the only authority. Editing an approved living doc resets it to `draft` (a baseline node is the exception: a write adds a pending revision of the ONE item it changes, status is derived, `lore review` then `lore approve [--item]` promotes it); a locked record refuses body/title/criteria rewrites (exit 4) — use `lore set --correction`, `lore reopen`, or a new linked record. `lore phase add|rm` does NOT demote but LOGS a version.
- ⛔ A listed doc is not proven live; validity is authoritative only by direct address.
- ⛔ The corpus is the ONLY spec index: read the governing spec (`lore get SPEC-0NN`, or `lore search`) before changing a module; exported mirrors live under `docs/requirements/{prd,spec,adr,knowledge,plan,task}/`, zero-padded 3-digit ids (`bun run mirror:export` / `check:spec-mirror`).

## Dogfooding

- ⛔ Eval every skill, hook, agent and gate we depend on; a broken or misleading one is a defect — fix it now or record the correct path.
- ⛔ Fix a lore defect at its mechanism root, on a surface that SHIPS (binary output, or `assets/` + manifest), and verify it from a fresh consumer install — never only in this repo, this machine's `~/.claude/`, or a hand-edited consumer config.
- New findings go only to the corpus (`lore create knowledge --sub-type retro`); this file never carries incident narratives.
- ⛔ A problem found here is fixed now when simple (≤2 files, an existing oracle proves the fix, no approved-spec behaviour changes), else file it as an issue (`lore report-issue`, also in this repo); a task names the issues it resolves, never a task whose subject is the problem (BR-1153).
- Standing lessons (oracle design, mirror export, test selection, governance tooling quirks) and their slugs: `knowledge-root-claude-md-tier-2-text-verbatim-body-before-the`.

# ─── lore governance (managed) ───
<!-- lore:managed section=module-index hash=8e411855 -->
## Module Index

Folders with their own memory file — read it before working there:

- [`packages/core/src`](packages/core/src/CLAUDE.md) — Foundational types, Result/LoreError, Zod schemas, lifecycle rules, config, and telemetry.
- [`packages/lore/src/adapters/cli`](packages/lore/src/adapters/cli/CLAUDE.md) — citty CLI adapter: lazy command registry and exit-code mapping.
- [`packages/lore/src/adapters/http`](packages/lore/src/adapters/http/CLAUDE.md) — `Bun.serve` HTTP API adapter: bearer-token auth and sync-push.
- [`packages/lore/src/ai`](packages/lore/src/ai/CLAUDE.md) — Runtime AI provider implementations, registry builder, template engine, assess/review judge prompt builders, AI-default resolution, and in-memory test double.
- [`packages/lore/src/eval`](packages/lore/src/eval/CLAUDE.md) — Six read-only evaluation scenarios under `lore eval`, measuring corpus health and search quality.
- [`packages/lore/src/service`](packages/lore/src/service/CLAUDE.md) — Business logic layer: stateless services, all returning `Promise<Result<T, LoreError>>`.
- [`packages/lore/src/store`](packages/lore/src/store/CLAUDE.md) — Async persistence abstraction: `StoreInterface` with SQLite / Turso / InMemory implementations and FTS5 escape.
- [`packages/dashboard`](packages/dashboard/CLAUDE.md) — Vite + React + shadcn local-dev web UI: read views plus the SPEC-022 write surface.
<!-- lore:managed section=command-table hash=92aff227 -->
Documented commands (package.json `lore.documentedScripts`):
- `dev`: `bun run packages/lore/src/index.ts` — Run the lore CLI from source; arguments after the script name go to lore.
- `build`: `bun run scripts/build.ts` — Compile the standalone binary to dist/lore.
- `typecheck`: `bun run typecheck:core && bun run typecheck:lore && bun run typecheck:lore-tests && bun run typecheck:scripts && bun run typecheck:dashboard && bun run typecheck:dashboard-tests && bun run typecheck:dashboard-e2e` — Run tsc over core, lore (src and tests), scripts and the dashboard (src, tests, e2e).
- `test:vitest`: `bun scripts/run-tests.ts` — Build dist/lore, then run every test file: vitest on Bun, then vitest on Node for the files in vitest.node-files.ts, then the test-file census.
- `test`: `bun scripts/oracle-lock.ts bun scripts/run-chain.ts` — Take the checkout's oracle lock, then run each check script and test:vitest in a fixed order; every step runs and a per-step exit table prints.
- `test:changed`: `bun scripts/changed-tests.ts` — Select and run the tests a change can affect, printing a reason per file; --list previews, an optional ref sets the diff base.
- `test:file`: `bun scripts/test-file.ts` — Run the named test files, each on the runner that collects it (Bun, or Node for files in vitest.node-files.ts); -t <name> and other flags pass through.
- `check:floor`: `bun scripts/run-chain.ts --floor` — Install, build, typecheck and the two diff-scoped :changed checks (the integrate floor); --list prints the step names.
- `check:plan-close`: `bun scripts/run-chain.ts --plan-close` — Run every check: script the integrate floor does not (the plan-close chain); --list prints the names.
- `check:memory-files`: `bun run packages/lore/src/index.ts context refresh --check` — Run `lore context refresh --check`: exit 1 when CLAUDE.md or a lore rules file differs from a fresh refresh, or the root file is over its ceiling.
<!-- lore:managed section=governance-pointer hash=760d2396 -->
## Finding Live Project State

Run `lore governance claude-md` for this project's memory-file content contract. The standing corpus-workflow discipline lives in the lore-owned `.claude/rules/lore-*.md` files (written by `lore context refresh`; inspect them with `lore fragments`).
<!-- lore:managed section=spec-discovery-pointer hash=4f2ed6d6 -->
Specs are not filed in this document — discover them via `lore search "<topic>"`, `lore tree`, or `lore get <spec-slug>`.
# ─── end lore governance ───

