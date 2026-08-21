# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

⛔ Before hand-editing this file, read its content contract: `lore governance claude-md` prints what belongs here vs. the corpus, and the line/byte ceiling enforced by `lore status --check-claude-md`.

## What This Is

**Lore** — AI-native shared knowledge/memory platform for AI-first teams (3-5 people + multiple AI agents). Single binary (`lore`) with three adapters: citty CLI (default), MCP server (`--mcp-server`), and HTTP server (`lore serve`). Storage is local SQLite via `bun:sqlite` by default; with `sync.enabled` it switches to a Turso embedded replica (`@libsql/client`) for multi-machine visibility. Delivers a typed, navigable corpus of PRDs, specs, ADRs, plans, knowledge, and tasks, with MDX placeholder resolution, version history, review workflow, tree-structure conformance checks, telemetry, and v1 migration.

## North Star — the standing design brief

⛔ Not a rule list. A rule that exists only as prose does not bind: measured 2026-08-17, an agent put a bold prohibition in its own dispatch bundle and then violated it the same turn, while the agent it had just instructed was still running. Same agent, same turn. This section is instead the set of questions every change is judged by.

**Target state**: development executed ~100% by AI, ~90% of decisions made by AI, work advancing unattended after the opening phase, and one project developed by MANY CONCURRENT SESSIONS.

**Why the corpus is the load-bearing thing**: as AI output outpaces human review, sampling stops scaling — 1% of ten times the output is still unreadable. The only check that scales is the corpus checking itself. So the corpus is not a record of what happened; it is the single source of truth AND the coordination mechanism. The ranking follows directly: **code wrong + corpus right → the next session repairs it; corpus wrong → correct code gets edited into broken code.** Corpus integrity outranks code correctness.

**Three properties the corpus must hold** — each mechanically checkable, none of them by agent diligence:

1. **It must not lie.** A verdict carries the state it describes (`ASSESSMENT_STALE` is the working prior art — generalize it, do not reinvent it). Rendering is injective: `fail` and `fail_superseded` must not both print `✘`. Labels are honest: `capture_source: runner` with no attestation block is a false label, and an agent has no second source to catch it with.
2. **It must not go silent.** Filtering leaves a trace in the count — `lore list` hiding invalidated docs behind a self-consistent total made a census wrong by 21×. "Vacuously true" must be distinguishable from "true" — an empty phase satisfies "every child task archived".
3. **It must be addressable.** Every assertion locatable and re-verifiable. 51 AC ids are currently claimed by more than one live spec, so a bare `AC-OX-6` in a handoff resolves to nothing.

**Four questions for every change**:

- Does this conclusion still hold with NO human present?
- What happens if two sessions do this at the same time? ⛔ An answer that relies on exclusivity — clean tree, exclusive corpus, single-writer file — is a refusal of the target state, not a design.
- What refuses this when it is violated? "An agent should remember" means NOT ENFORCED — say so, and count it.
- What is the smallest mutation that turns this oracle red? Cannot name one → it has no discriminating power. `lore ac add --falsifier-*` makes that machine-checkable.

⛔ Self-checking must stay cheaper than corpus growth. A full-suite verdict costs 869s AND a clean tree; under real concurrency the tree is never clean, so that verdict form is already unobtainable rather than merely slow. Prefer incremental, local, concurrency-safe checks.

## Commands

```bash
bun run dev               # Run from source (packages/lore/src/index.ts)
bun run build             # Compile to dist/lore binary (bun build --compile)
bun run typecheck         # tsc --noEmit for all packages + scripts

# Tests — two runners, both must pass
bun run test:vitest       # bunx vitest run — covers non-bun:sqlite files
bun run test:bun          # cd packages/lore && bun test .bun.test
bun run test              # both runners in sequence
bun run test:changed [<base>]  # deterministic worktree oracle (default base: merge-base main HEAD); --list previews
                               # ⛔ STILL UNDER-SELECTS: a tree-scanning test naming no literal path, and any consumer reaching its target through a dynamic `await import()` — run those BY HAND. Also structurally blind to `.bun.test.ts` via `vitest --changed`. The `hooks/**` + `assets/**` gap is CLOSED (`16a24f00`, AC-TC-4): a hook or asset edit now selects both pre-push guards, verified on the shipped CLI with real git data. ⛔ The marker-ONLY fix was measured INERT — membership and scope are two conjunctive gates and both must change. `knowledge-bun-run-test-changed-full-selection-contract-and-its`

# Run a single vitest test file
bunx vitest run packages/lore/tests/unit/service/corpus-service.test.ts

# Run a single bun test file
cd packages/lore && bun test tests/unit/store/sqlite-store.bun.test.ts
```

**Test file convention**: Files ending in `.bun.test.ts` run under `bun test` only (they use `bun:sqlite`). All other `.test.ts` files run under vitest. Do not mix runners.

**Pre-push corpus gate**: `hooks/pre-push` runs, in this order — `lore status --check-binary-provenance` (SPEC-134, armed 2026-08-17; FIRST on purpose, since every check after it is issued by that binary), `--check-tree --check-drift`, `lore audit --verify` (SPEC-081 G5), `--check-prd-budget` (SPEC-080 Phase 3, armed 2026-07-26), `--check-claude-md`, and finally `bun scripts/check-anchor-coverage.ts` (SPEC-134 AC-BFI-9, armed 2026-08-17 — a REPO SCRIPT, not a `lore` subcommand, so it is skipped rather than fatal when absent). Fail-open when `lore`/`.lore/` absent; bypass with `--no-verify`. ⛔ Do not pin the COUNT here — "FOUR checks" was false the moment a fifth landed, and a fifth-and-sixth landed the same day; read the hook. ⛔ Provenance blocks on a `dist/lore` older than HEAD (exit 3), which is EVERY merge not followed by `bun run build`, so the rebuild is now part of landing a merge — after the last agent of a batch returns, never mid-wave. ⛔ It runs NO tests, so every test-shaped oracle is push-invisible: `packages/lore/tests/unit/build/embed-assets-manifest.test.ts` DOES pin the checked-in generated manifest against a fresh recomputation over `assets/`, yet a stale manifest still reached main (`c3803eb2`) because nothing ran it — an existing sound oracle is not a gate until something invokes it. Byte-identical pair with `assets/project/pre-push` (parity-pinned; regen assets manifest on edit). After clone, activate with `git config core.hooksPath hooks`.

**⛔ Never write to the repo's own `.lore/` corpus from tests or smoke checks.** The repo corpus is the team's live knowledge base. Any manual smoke test or e2e run that creates/edits docs MUST use a throwaway corpus (`mkdtemp` + `lore init`, cwd inside it) — see `packages/dashboard/tests/e2e/global-setup.ts` for the canonical pattern. Also never assume a server answering on port 8787 is yours: a stale `lore dashboard` serving the real corpus once absorbed an e2e write suite (2026-07-07 pollution incident — 6 foreign docs, corrupted export numbering).

## Architecture

### Layer Stack

```
packages/lore/src/adapters/cli/   ← citty CLI (default entry; index.ts's registry is the only true command count)
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

**Result<T, LoreError>** — no exceptions cross service boundaries. Every service method returns `Promise<{ ok: true; value: T } | { ok: false; error: LoreError }>`. Use `ok()` and `err()` helpers from `@lore/core`. see `errors.ts` for the `LoreError` codes.

**StoreInterface is async** — methods return `Promise<Result<T, LoreError>>`. This is the contract both `SQLiteStore` (wraps sync `bun:sqlite` calls) and `TursoStore` (`@libsql/client`, natively async) implement. `InMemoryStore` is the test double. Services depend on `StoreInterface`, never on a concrete store.

**Store selection (D-007)** — `createApp(dbPath, config?)`:
- No config / `sync.enabled !== true` → `SQLiteStore` (local-only, returned directly as `App`).
- `sync.enabled: true` + `remote_url` + valid `LORE_SYNC_TOKEN` env var → `TursoStore` (embedded replica) wrapped in `Result<App>`.
- Sync enabled, credentials missing → `err(VALIDATION_ERROR)` (from `resolveSyncCredentials`, propagated verbatim); TursoStore construction fails → `err(STORE_ERROR)`. **No silent fallback** to SQLiteStore — offline writes must not land only-local.

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

Editing an `approved` doc resets it to `draft` automatically — content/title AND `extra` — except the ledger knowledge sub-types (`assessment | retro | handoff | uat`), which are re-fast-tracked to `approved` in the SAME write, so an edit logs two versions at one timestamp and never enters the review queue. ⛔ The two AC writers are ASYMMETRIC, and a prior version of this line asserted they were not: `lore ac set` demotes an approved spec to `draft`; **`lore ac add` does NOT** — criteria can be appended to an approved spec indefinitely without re-entering review, so an approval certifies the AC set as of approval time, not the set a reader sees. Measured 2026-08-11: `knowledge-five-findings-from-planning-the-bootstrap-fixpoint` §3.

### MDX Placeholder Components (OutlineService)

Whitelisted components resolved at read time: `ChildrenOf`, `RecentDecisions`, `ActivePlans`, `ModuleTree`, `RelatedOf`, `Embed`, `HealthStats`. Unknown components are stripped with a warning (not an error).

### Type-specific Validation (CreateDocInput)

- `spec` and `task` require `parent_id`
- `adr` requires `extra.decision_status` (`proposed | accepted | deprecated | superseded`)
- `knowledge` requires `extra.sub_type` (`ideation | retro | research | reference`)
- `task` requires `extra.plan_id`

Enforced via Zod `superRefine` in `packages/core/src/schemas.ts`.

### Dogfooding: Skill/Tool Eval Log

Building Lore is itself run **through** the Lore-governed workflow (corpus chain + skills + gates). Dogfooding is our credibility source: if we don't follow best practice while building the tool that enforces best practice, we can't claim other teams should trust it.

**⛔ Consciously eval every skill/tool we depend on — never assume it is already optimal.** A broken, misleading, or sub-optimal skill/hook/agent/gate is a defect: fix it immediately (or course-correct + record the correct path).

**⛔ Boundary rule (2026-07-22)**: new findings are recorded ONLY in the lore corpus (`lore create knowledge --sub-type retro`), plus at most a one-line standing lesson below. CLAUDE.md never carries full incident narratives — they go stale (proven: a "not yet built" status here outlived the mechanism being built). `docs/claude-md-archive/` is a FROZEN pre-2026-07-22 snapshot — never append to it.

**⛔ A lore defect is fixed at its MECHANISM ROOT and verified from a FRESH consumer install — never patched on whichever surface happened to expose it.** Two questions gate every lore fix: (1) *what mechanism made this possible?* — prose that "should have been followed" is not a mechanism, and a defect already covered by existing prose is proof that the prose layer is the wrong layer; (2) *would a project that just ran `lore init` + `lore setup` still hit this?* — if yes, it is not fixed (BUT a fresh install cannot REACH convergence/diff-shaped defects — removal, retirement, pruning: the probe must construct BOTH ends of the diff plus a live control, else it vacuously passes; `knowledge-retro-a-fresh-install-probe-vacuously-passes`). The fix MUST land on a surface that SHIPS (binary-side output/payload, or `assets/` SSOT + manifest), never only in this repo's own files, this machine's `~/.claude/` copy, or a hand-edited consumer config (see the distribution-first lesson below).

**Standing lessons** — one line each, scope only. Full text: `knowledge-retired-from-root-claude-md-the-19-dogfooding`, `knowledge-retired-from-root-claude-md-2026-08-13-three-standing`; pre-2026-07-22 history: `docs/claude-md-archive/dogfood-eval-log.md` (FROZEN).

- False oracles — exit-code-true ≠ measured-the-right-thing; V7: one exit code cannot tell "it failed" from "never ran" — pair with a GREEN control. `knowledge-the-green-control-pattern-and-its-cost-a-falsifier`
- Eight pointer-less lessons were evicted VERBATIM and remain normative — substring matchers, SSOT↔asset parity, distribution oracles, worktree dispatch order, `spawnSync`/`set -e`, main-checkout actor, path-scoped commits, clean-tree verdicts: `knowledge-retired-from-root-claude-md-eight-pointer-less`
- ⛔ NINE lessons were evicted as UNENFORCED — nothing refuses them if violated. They stay NORMATIVE, and each names the mechanism it still needs: `knowledge-the-nine-unenforced-standing-lessons-evicted-from`. That count is the honest distance to unattended operation. A `plan-close` prose copy was also dropped: the gate enforces it (`lore gate plan-close --explain` is the SSOT).
- Distribution-first: name the delivery surface or it does not exist for consumers. `adr-distribution-first-every-improvement-names-its-consumer`
- Spec close-outs write NOTHING to this file. `adr-claude-md-specs-section-is-pointer-only-per-spec-index`
- A new deterministic gate retroactively invalidates the back-catalog — budget the sweep + a written exemption in the SAME slice. `knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`
- Marker censuses over a self-documenting corpus over-match: anchor structurally + require a second independent condition. `knowledge-the-substring-matcher-lesson-has-a-mirror-face-over`
- Before blaming a red suite on the diff: timeouts ≠ assertion mismatches, check isolation, read MEMORY not load average. `knowledge-load-average-is-the-wrong-instrument-for-is-this-red`
- ⛔ Tightening an AC via `lore ac set` drops the spec to `draft` and hard-blocks EVERY descendant claim (`ac add` does not demote — see the asymmetry above) — re-read the spec's status immediately before each dispatch, never from a batch-start snapshot. Same doc.
- ⛔ A literal corpus count inside a governance doc is a claim with no oracle — cite the `lore status --json` field instead. A `pass_unfalsified` figure justifying a decision was off 20x. Same doc.
- ⛔ An ATTESTED pass is not evidence of production wiring: if the AC's command exercises the implementation layer while its prose promises a user-facing surface, attestation certifies an unreachable capability with the corpus's strongest evidence tier. Split any AC whose prose names two layers; a surface AC's oracle MUST drive the surface. Measured: 2 of 3 found by `lore assess`, all AFTER attestation — assess is load-bearing, not advisory-in-practice. `knowledge-an-attested-pass-is-not-evidence-of-production-wiring`
- ⛔ An `assess` MAJOR can be exactly BACKWARDS — one read a rename's SOURCE side as the result and indicted a filename that same commit FIXED. Machine-check every finding that names a path before scoring it; path existence is decidable, never a judgment. Same doc.
- ⛔ MEASURE a field/command before pinning an AC's oracle to it, and never pair that pin with a clause REFUSING the alternative in the same round: pinning `lore status --json` (which surfaces `ai_defaults` but NOT arbitrary resolved config) while forbidding a hand-rebuilt merge left an AC with no runnable oracle at all. Tightening an oracle can DESTROY it. `knowledge-five-governance-tooling-gaps-measured-while-resuming`
- ⛔ `lore ac list`'s count is scoped by the recording task's PLAN LINEAGE and IGNORES `ac_scope` — polarity inverted from the flag's own help. Attested rows from a task that declared the AC go uncounted; a task declaring none is counted. And `oracle_generation` bumps only when `verify.command` changes, so a stable command over a rewritten test file reads green forever. `knowledge-ac-coverage-counts-evidence-by-plan-lineage-and`

### AI Default Behavior by Caller Surface (SPEC-024)

AI is ON for human surfaces (`cli`, `http_cookie`) and OFF for agent surfaces (`agent` — signalled by `CLAUDECODE=1` / `CI=true` / `LORE_AI_DEFAULT=off` —, `mcp`, `http_token`), so `lore create` never nests a Claude call. Override per call with `--ai` / `--no-ai` (both → exit 2), or per surface via `ai.default_per_surface.<surface>` in `.lore/config.yaml`; resolved values in `lore status --json`. Full detection table: `lore get SPEC-024`.

### Implementation Status

Phase 1 (core + CLI + service layer) and Phase 2 (MCP, HTTP, Turso sync, telemetry, tree conformance, eval) are landed; active work is incremental hardening. Per-spec SSOT: `lore get SPEC-0NN`. Retired verbatim text: `knowledge-retired-from-root-claude-md-the-implementation-status`; pre-2026-07-22 mechanism subsections: `docs/claude-md-archive/spec-implementation-notes.md` (FROZEN).

Cross-cutting rules extracted from it: gates run in the SERVICE layer so CLI/MCP/HTTP writes are gated identically (per-checkpoint knob `workflow.gates.<checkpoint>.enabled`); `extra.phase` validates against the MEMBER plan via `extra.plan_id`, ⛔ never the `parent_id` proxy; `--worktree` is ALWAYS explicit on `lore claim`; `lore done` needs a RUNNER-ATTESTED pass (audited `--override-attestation` escape); `lore ready`'s `sessions[]` is plan-scoped/fresh-only while `lore bootstrap`'s `active_sessions` is corpus-wide and FLAGS `stale` (⛔ ≠ death); ⛔ a session-collapse report is NEVER fixed by prescribing a more unique `LORE_ACTOR`; ⛔ a listed doc is NOT proven live — validity is authoritative only by direct address. The v1 predecessor at `~/.claude/docman-mcp` is frozen — do not carry over its schema or API shape.

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

- `lore search <query>` — FTS5 full-text search over the corpus
- `lore get <id-or-slug>` — read a document (add `--resolve-mdx` to expand placeholders)
- `lore list --type <type>` — filter docs by type (`prd | spec | adr | plan | knowledge | task`)
- `lore tree` — view the document hierarchy (root → specs → tasks)
- `lore pending` — list docs awaiting review
- `lore log <id-or-slug>` — version history; `lore diff <id> --from N --to M` for unified diff
- `lore status` — corpus-level health snapshot
- ⛔ The corpus is the ONLY spec index — read the governing spec (`lore get SPEC-0NN`, or `lore search`) before changing a module; exported mirrors live under `docs/requirements/{prd,spec,adr,knowledge,plan,task}/`, zero-padded 3-digit ids (`bun run mirror:export` / `check:spec-mirror`).
<!-- /auto:dynamic-context -->
