# CLAUDE.md

⛔ Before hand-editing this file, read its content contract: `lore governance claude-md`. This file is tier 1 — rules only, no reasoning. The reasoning, mechanism notes and standing-lessons index behind every line here: `knowledge-root-claude-md-tier-2-text-verbatim-body-before-the`.

## What This Is

**Lore** — AI-native shared knowledge/memory platform for AI-first teams (3-5 people + many AI agents). One binary, `lore`: citty CLI (default), MCP server (`--mcp-server`), HTTP server (`lore serve`). Local SQLite (`bun:sqlite`) by default; a Turso embedded replica when `sync.enabled`.

## North Star

Target: development ~100% by AI, one project worked by MANY CONCURRENT SESSIONS, unattended after the opening phase. The corpus is the SSOT and the coordination mechanism, so **corpus integrity outranks code correctness**.

- The corpus must not lie (a verdict carries the state it describes; rendering is injective; labels are honest), must not go silent (filtering leaves a trace in the count; "vacuously true" is distinguishable from "true"), and must be addressable (every assertion locatable and re-verifiable).
- Ask of every change: does it hold with NO human present? What if two sessions do it at once (⛔ an answer relying on exclusivity is a refusal of the target state)? What refuses it when violated ("an agent should remember" = NOT ENFORCED — say so, count it)? What is the smallest mutation that turns its oracle red (`lore ac add --falsifier-*`)?
- ⛔ Self-checking must stay cheaper than corpus growth: prefer incremental, local, concurrency-safe checks over full-suite verdicts.

## Commands

```bash
bun run dev               # run from source
bun run build             # compile dist/lore
bun run typecheck         # tsc for all packages + scripts
bun run test:vitest       # vitest: every *.test.ts that is not *.bun.test.ts
bun run test:bun          # bun test: *.bun.test.ts (bun:sqlite)
bun run test              # ⛔ NOT "both runners": an && chain, a red vitest skips the rest
bun run test:changed [<base>]  # worktree oracle; ⛔ under- AND over-selects — hand-pick consumers, re-verify on main
bunx vitest run <file>                  # one vitest file
cd packages/lore && bun test <file>     # one bun file
```

- `*.bun.test.ts` run only under `bun test`; every other `*.test.ts` only under vitest. Never mix runners.
- ⛔ Never write to the repo's own `.lore/` from tests or smoke checks — use a throwaway corpus (`mkdtemp` + `lore init`). ⛔ Never assume a server on port 8787 is yours.
- Pre-push gate: its checks and their order live in `hooks/pre-push`, never here. ⛔ Every merge to main is followed by `bun run build` (a `dist/lore` older than HEAD is refused), after the batch's last agent returns. After clone: `git config core.hooksPath hooks`.

## Architecture

Repo-wide invariants. The why, the layer stack, the service table and per-module facts are tier 2: module CLAUDE.md files and `knowledge-root-claude-md-tier-2-text-verbatim-body-before-the`.

- **Result<T, LoreError>**: no exception crosses a service boundary; every service method returns `Promise<Result<…>>` built with `ok()` / `err()` from `@lore/core`.
- Services depend on the async `StoreInterface`, never on a concrete store. ⛔ No silent fallback: a missing required input fails loud.
- Imports: cross-package only via `@lore/core`; intra-package relative `.js` paths; the `@core/*`-style aliases are retired.
- ⛔ `@lore/core`'s default barrel never imports a Node builtin; Node IO lives in `@lore/core/node`, which `packages/dashboard/src/**` never imports.
- A doc has `id` (ULID, immutable) and `slug` (editable); services accept either via `corpusService.resolve`.
- Gates run in the service layer, so CLI, MCP and HTTP writes are gated identically.
- Lifecycle: `VALID_TRANSITIONS` in `packages/core/src/schemas.ts` is the only authority. Editing an approved living doc resets it to `draft`; a locked record refuses body/title/criteria rewrites (exit 4) — use `lore set --correction`, `lore reopen`, or a new linked record. `lore phase add|rm` does NOT demote but LOGS a version.
- ⛔ A listed doc is not proven live; validity is authoritative only by direct address.

## Dogfooding

- ⛔ Eval every skill, hook, agent and gate we depend on; a broken or misleading one is a defect — fix it now or record the correct path.
- ⛔ Fix a lore defect at its mechanism root, on a surface that SHIPS (binary output, or `assets/` + manifest), and verify it from a fresh consumer install — never only in this repo, this machine's `~/.claude/`, or a hand-edited consumer config.
- New findings go only to the corpus (`lore create knowledge --sub-type retro`); this file never carries incident narratives.
- Standing lessons (oracle design, mirror export, test selection, governance tooling quirks) and their slugs: `knowledge-root-claude-md-tier-2-text-verbatim-body-before-the`.

<!-- auto:module-index -->
## Module Index

Module-specific context lives alongside the code:

- [`@lore/core`](packages/core/src/CLAUDE.md) — types, Result/LoreError, Zod schemas, lifecycle rules, config, telemetry
- [`packages/lore/src/service`](packages/lore/src/service/CLAUDE.md) — six stateless services, all return `Promise<Result<T, LoreError>>`
- [`packages/lore/src/store`](packages/lore/src/store/CLAUDE.md) — async StoreInterface + SQLite / Turso / InMemory + FTS5 escape
- [`packages/lore/src/adapters/cli`](packages/lore/src/adapters/cli/CLAUDE.md) — citty CLI, lazy command registry, exit-code mapping
- [`packages/lore/src/adapters/mcp`](packages/lore/src/adapters/mcp/CLAUDE.md) — MCP stdio server, 16 `lore_*` tools, fast-path registration
- [`packages/lore/src/adapters/http`](packages/lore/src/adapters/http/CLAUDE.md) — Bun.serve API, bearer-token auth, sync-push
- [`packages/lore/src/eval`](packages/lore/src/eval/CLAUDE.md) — six read-only evaluation scenarios under `lore eval`
- [`@lore/dashboard`](packages/dashboard/CLAUDE.md) — Vite + React + shadcn local-dev web UI (read views + SPEC-022 write surface)
<!-- /auto:module-index -->

<!-- auto:dynamic-context -->
## Finding Live Project State

Lore is itself the knowledge store — query it through its own CLI rather than reading docs by path:

- `search` (FTS5) / `get` (`--resolve-mdx` expands placeholders) / `list --type` / `tree` / `pending` / `log` + `diff --from N --to M` / `status`. Flags: `--help` on each — never transcribed here.
- ⛔ The corpus is the ONLY spec index — read the governing spec (`lore get SPEC-0NN`, or `lore search`) before changing a module; exported mirrors live under `docs/requirements/{prd,spec,adr,knowledge,plan,task}/`, zero-padded 3-digit ids (`bun run mirror:export` / `check:spec-mirror`).
<!-- /auto:dynamic-context -->
