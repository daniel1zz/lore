# Lore

> AI-native shared knowledge platform for AI-first teams.

**Lore** is the structured knowledge / memory substrate for teams that run multiple AI agents alongside humans. Every PRD, spec, ADR, plan, task, and retro lives in one navigable corpus — readable and writable by Claude Code, Cursor, Codex, custom agents, and humans alike.

## What This Is

A single CLI binary (`lore`) that:

- **Stores** a typed, navigable corpus of project knowledge in local SQLite (`.lore/`), with full-text search, version history, and a review workflow
- **Enforces** workflow discipline through deterministic gates that intercept non-conforming writes at the service layer — so the CLI, the MCP server, and the HTTP API are all governed identically
- **Exposes** the same surface to AI agents (MCP server), humans (CLI + local web dashboard), and automation (HTTP API with bearer auth)
- **Syncs** the corpus across machines and teammates via an optional Turso embedded replica
- **Centers** on the **PRD-as-living-root** model — every doc is reachable through a tree rooted at the product PRD, via MDX placeholder components that resolve to live subtrees on read

## Why

When several AI agents work the same repository, the expensive failures are not bad code — they are lost context, duplicated work, silently conflicting edits, and completion claims nobody verified.

Lore's answer is to move those rules out of prompts and into the tool: context is **pulled** before producing, tasks are **claimed** before being worked, and "done" requires an **exit code from an external runner**, not a model's self-assessment. Prompt text can be ignored; an `exit 4` cannot.

## Install

Requires [Bun](https://bun.sh). The repo declares no minimum version; it is developed against the 1.3.x line.

```bash
git clone <repo-url> lore && cd lore
bun install
bun run build          # → dist/lore
./dist/lore --help
```

Put `dist/lore` on your `PATH` (a symlink works) to get the `lore` command everywhere.

> **npm distribution**: the packaging and publish pipeline exists (`scripts/publish-npm.ts`, per-platform packages, nudge-only postinstall), but the npm scope is still a placeholder and **nothing has been published yet**. Build from source for now.

## Quick Start

One-time machine setup — installs the Claude Code integration (MCP registration, agents, skills) into `~/.claude`:

```bash
lore setup --dry-run   # print the install plan, zero writes
lore setup --yes
```

Then, per project:

```bash
cd your-project
lore init                        # create the .lore/ corpus
lore setup --project --yes       # scaffold this repo's Lore-governed workflow
```

`lore setup` without `--project` is the **global machine install**; `--project` is the **per-repo scaffold**. Both support `--dry-run` (zero writes), `--check` (read-only freshness against the embedded asset manifest), and `--uninstall`.

A first document:

```bash
lore create prd --title "Product positioning"
lore tree              # see the corpus hierarchy
lore search "auth"     # FTS5 full-text search
lore status            # corpus health snapshot
```

`lore --help` lists every command group; `lore <command> --help` documents one.

## The Workflow

Lore models a four-stage loop. Each stage has real commands, and the gates fire between them.

**FEED — pull context before producing.**
`lore bootstrap` (session-wide overview), `lore feed session-resume` (pick up interrupted work), `lore feed task-start` (what one task requires), `lore search` / `lore get` / `lore tree`.

**PRODUCE — write documents along the type chain.**
`prd → spec → plan → task`, with `adr` and `knowledge` branching off. Acceptance criteria are written as executable commands (`lore ac add`), phases as plan structure (`lore phase add`), and each task declares the files it will touch (`lore create task --anchor <path>`).

**EXECUTE — claim first, then prove it.**
`lore ready <plan>` shows what is claimable and where file anchors collide. `lore claim` takes the lease, `lore verify` runs script-mode acceptance criteria under a trusted runner, `lore release` drops the lease, and `lore done` archives the task — which requires at least one runner-attested pass.

**CLOSE — feed the loop back.**
`lore assess <plan>` scores how the plan actually landed, `lore anchor add` binds a spec to the code that implements it, `lore invalidate` retires knowledge that was proven wrong, and `lore handoff` writes the ticket the next session resumes from.

### Gates

Deterministic checkpoints refuse non-conforming writes with `exit 4` plus a "feeding pack" describing exactly what is missing. They run in the service layer, so every adapter inherits them.

`lore gate --help` is the authoritative list — do not trust a count written down elsewhere, including here. Today it spans spec creation, spec promotion, plan promotion, plan close, task claim, and phase claim. All but `plan-close` also run as a read-only pre-flight (`lore gate <checkpoint> --plan <plan>`); `plan-close`'s predicates fire only on the archival write, and `lore gate plan-close --explain` prints their contract table, including each predicate's known false-pass and false-block deltas.

AI judgment (`lore review`'s AI pass, `lore assess`) is **always advisory** and never blocks. Only deterministic checks block.

Disable a checkpoint deliberately via `workflow.gates.<checkpoint>.enabled: false` in `.lore/config.yaml`. (`LORE_GATE_BYPASS=1` affects only the `lore gate` pre-flight command — the write path never honors it.)

### Concurrency

Built for several agents working one repository at once:

- **Anchor mutex** — tasks declaring overlapping file anchors cannot be claimed concurrently
- **Actor identity** — every agent carries its own `LORE_ACTOR`, so claims are attributable
- **Ownership surfaces** — `lore territory` partitions worktrees and branches into mine / foreign / unowned; `lore session list` joins corpus claims against probed process liveness

## Surfaces

| Surface | Entry | For |
|---|---|---|
| CLI | `lore <command>` | humans, scripts, agents shelling out |
| MCP server | `lore --mcp-server` | Claude Code, Cursor, and other MCP clients |
| HTTP API | `lore serve` | automation, remote access (bearer-token auth) |
| Web dashboard | `lore dashboard` | browsing and editing the corpus in a browser |

## Storage & Sync

Local-only by default: SQLite via `bun:sqlite`, everything under `.lore/`.

Set `sync.enabled: true` plus a `remote_url` and a `LORE_SYNC_TOKEN`, and the store switches to a Turso embedded replica for multi-machine visibility. If sync is enabled but credentials are missing, Lore **fails loudly** rather than silently writing local-only — an offline write that lands nowhere is worse than a refused one.

## Architecture

```
packages/lore/src/adapters/cli/    ← citty CLI (default entry)
packages/lore/src/adapters/mcp/    ← MCP stdio server
packages/lore/src/adapters/http/   ← Bun.serve HTTP API
packages/lore/src/service/         ← business logic + gates
packages/lore/src/store/           ← async StoreInterface (SQLite / Turso / InMemory)
packages/core/                     ← types, errors, Zod schemas, config (@lore/core)
packages/dashboard/                ← Vite + React web UI
```

Design invariants: no exceptions cross a service boundary (every service method returns `Result<T, LoreError>`); services depend on `StoreInterface`, never a concrete store; `@lore/core` stays browser-safe with Node-only IO isolated in `@lore/core/node`.

Deeper module context lives next to the code in per-module `CLAUDE.md` files.

## Project Status

Lore is in active use and dogfoods itself — this repository's own PRDs, specs, plans, and retros live in its own corpus, governed by its own gates.

Status is **queried, never restated**, because a status line in a README goes stale silently:

```bash
lore status            # corpus health, doc counts, drift
lore list --type spec --include-invalid
lore tree
```

Per-spec source of truth is the corpus itself (`lore get SPEC-0NN`, `lore search`). Read-only markdown mirrors are exported under `docs/requirements/{prd,spec,adr,knowledge,plan,task}/` via `bun run mirror:export`.

## Development

```bash
bun run dev            # run from source
bun run build          # compile dist/lore
bun run typecheck      # tsc --noEmit across all packages

bun run test           # both runners in sequence, plus the spec-mirror check
bun run test:vitest    # vitest — everything not touching bun:sqlite
bun run test:bun       # bun test — *.bun.test.ts files (they use bun:sqlite)
bun run test:changed   # deterministic change-scoped selection across both runners
```

**Test runner convention**: files ending in `.bun.test.ts` run under `bun test` only, because they import `bun:sqlite`. Everything else runs under vitest. Do not mix runners in one file.

**Pre-push gate**: `hooks/pre-push` runs a fixed sequence of corpus checks before every push — binary provenance first (every later check is issued by that binary), then tree and code-anchor conformance, audit-chain verification, the PRD outline budget, the CLAUDE.md budget, and the anchor-coverage ratchet. Read the hook for the current sequence rather than a count written here. Activate it after cloning:

```bash
git config core.hooksPath hooks
```

Note that it runs **no tests**. Every test-shaped oracle is therefore push-invisible: a sound test that nothing invokes is not a gate.

## Naming

**Lore** /lɔːr/ — "team lore", "project lore" — the accumulated knowledge that lives in a project's history. Pronounceable, 4 chars, CLI-friendly (`lore get spec-auth-v2`).
