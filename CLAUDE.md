# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

⛔ Before hand-editing this file, read its content contract: `lore governance claude-md` prints what belongs here vs. the corpus, and the line/byte ceiling enforced by `lore status --check-claude-md`.

## What This Is

**Lore** — AI-native shared knowledge/memory platform for AI-first teams (3-5 people + multiple AI agents). Single binary (`lore`) with three adapters: citty CLI (default), MCP server (`--mcp-server`), and HTTP server (`lore serve`). Storage is local SQLite via `bun:sqlite` by default; with `sync.enabled` it switches to a Turso embedded replica (`@libsql/client`) for multi-machine visibility. Delivers a typed, navigable corpus of PRDs, specs, ADRs, plans, knowledge, and tasks, with MDX placeholder resolution, version history, review workflow, tree-structure conformance checks, telemetry, and v1 migration.

## North Star — the standing design brief

⛔ Not a rule list. A rule that exists only as prose does not bind — an agent has violated a bold prohibition in its own dispatch bundle the same turn it wrote it. This section is the set of questions every change is judged by.

**Target state**: development executed ~100% by AI, ~90% of decisions made by AI, work advancing unattended after the opening phase, and one project developed by MANY CONCURRENT SESSIONS.

**Why the corpus is load-bearing**: as AI output outpaces human review, sampling stops scaling — 1% of ten times the output is still unreadable, so the only check that scales is the corpus checking itself. The corpus is therefore not a record of what happened; it is the SSOT AND the coordination mechanism. Hence the ranking: **code wrong + corpus right → the next session repairs it; corpus wrong → correct code gets edited into broken code.** Corpus integrity outranks code correctness.

**Three properties the corpus must hold** — each mechanically checkable, none of them by agent diligence:

1. **It must not lie.** A verdict carries the state it describes (`ASSESSMENT_STALE` is the working prior art — generalize it, do not reinvent it). Rendering is injective: `fail` and `fail_superseded` must not both print `✘`. Labels are honest: `capture_source: runner` with no attestation block is a false label, and an agent has no second source to catch it with.
2. **It must not go silent.** Filtering leaves a trace in the count — a self-consistent total that hides invalidated docs makes every census over it wrong. "Vacuously true" must be distinguishable from "true" — an empty phase satisfies "every child task archived".
3. **It must be addressable.** Every assertion locatable and re-verifiable. While one AC id is claimed by more than one live spec, a bare `AC-OX-6` in a handoff resolves to nothing.

**Four questions for every change**:

- Does this conclusion still hold with NO human present?
- What happens if two sessions do this at the same time? ⛔ An answer that relies on exclusivity — clean tree, exclusive corpus, single-writer file — is a refusal of the target state, not a design.
- What refuses this when it is violated? "An agent should remember" means NOT ENFORCED — say so, and count it.
- What is the smallest mutation that turns this oracle red? Cannot name one → it has no discriminating power. `lore ac add --falsifier-*` makes that machine-checkable.

⛔ Self-checking must stay cheaper than corpus growth. A full-suite verdict costs both a long run AND a clean tree; under real concurrency the tree is never clean, so that verdict form is unobtainable, not merely slow. Prefer incremental, local, concurrency-safe checks.

## Commands

```bash
bun run dev               # Run from source (packages/lore/src/index.ts)
bun run build             # Compile to dist/lore binary (bun build --compile)
bun run typecheck         # tsc --noEmit for all packages + scripts

# Tests — two runners, both must pass
bun run test:vitest       # bunx vitest run — covers non-bun:sqlite files
bun run test:bun          # cd packages/lore && bun test .bun.test
bun run test              # ⛔ NOT "both runners" — a 4-link && chain ending in check:spec-mirror; a red vitest
                          # short-circuits the rest. `knowledge-prd-001-s-prose-contradicts-the-exporter-it-describes`
bun run test:changed [<base>]  # deterministic worktree oracle (default base: merge-base main HEAD); --list previews
                               # ⛔ UNDER-selects (tree-scanning tests naming no literal path; consumers reached via dynamic `await import()`; `.bun.test.ts` via `vitest --changed`) AND OVER-selects (a high-fan-in edit can select the whole suite a worktree forbids). ⇒ hand-pick direct consumers, run the blind ones BY HAND, re-verify on main. Selection contract, closed sets, and why a marker-only fix is INERT: `knowledge-bun-run-test-changed-full-selection-contract-and-its`

# Run a single vitest test file
bunx vitest run packages/lore/tests/unit/service/corpus-service.test.ts

# Run a single bun test file
cd packages/lore && bun test tests/unit/store/sqlite-store.bun.test.ts
```

**Test file convention**: Files ending in `.bun.test.ts` run under `bun test` only (they use `bun:sqlite`). All other `.test.ts` files run under vitest. Do not mix runners.

**Pre-push corpus gate**: ⛔ Read `hooks/pre-push` for the checks and their ORDER — never pin either here (a pinned count went false the day two more landed). Standing invariants: `--check-binary-provenance` runs FIRST on purpose, since every later check is issued by that binary; `check-anchor-coverage.ts` is a REPO SCRIPT, so absent = skipped, not fatal; fail-open when `lore`/`.lore/` absent; bypass with `--no-verify`. ⛔ Provenance blocks on a `dist/lore` older than HEAD (exit 3) = EVERY merge not followed by `bun run build`, so the rebuild is part of landing a merge — after the last agent of a batch returns, never mid-wave. ⛔ It runs NO tests: a test-shaped oracle is push-invisible until something INVOKES it, and POSITION decides invocation — a `&&`-terminal check never runs while main is red. `knowledge-a-gate-at-the-end-of-a-chain-is-never-invoked-while` Byte-identical pair with `assets/project/pre-push` (parity-pinned; regen assets manifest on edit). After clone: `git config core.hooksPath hooks`.

**⛔ Never write to the repo's own `.lore/` corpus from tests or smoke checks** — it is the team's live knowledge base. Any smoke/e2e run that creates or edits docs MUST use a throwaway corpus (`mkdtemp` + `lore init`, cwd inside it); canonical pattern: `packages/dashboard/tests/e2e/global-setup.ts`. ⛔ Never assume a server on port 8787 is yours — a stale `lore dashboard` on the real corpus once absorbed an entire e2e write suite.

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

**Store selection (D-007)** — `createApp(dbPath, config?)`: no `sync.enabled` → `SQLiteStore` (returned directly as `App`); `sync.enabled` + `remote_url` + valid `LORE_SYNC_TOKEN` → `TursoStore` embedded replica in `Result<App>`. ⛔ **No silent fallback**: missing credentials → `err(VALIDATION_ERROR)` (verbatim from `resolveSyncCredentials`), construction failure → `err(STORE_ERROR)`. Offline writes must not land only-local.

**Import style (monorepo)** — path aliases `@core/*`, `@store/*`, `@service/*`, `@adapters/*` are retired. Cross-package imports use `@lore/core` (resolved via Bun workspaces). Intra-package imports within `packages/lore/` use relative `.js` paths. No `resolve.alias` in vitest.

**`@lore/core` is browser-safe; Node-only IO lives in `@lore/core/node`** — ⛔ the default barrel must never top-level-import a Node builtin, or the SPA blanks before React mounts. The `@lore/core/node` subpath is for server code (`packages/lore/**`, `scripts/**`) and ⛔ never for `packages/dashboard/src/**`. Mechanism, split-file list, and both oracles: `packages/core/src/CLAUDE.md` (do not restate them here — that file owns them).

**DocRecord has two identifier fields**: `id` (ULID, immutable PK) and `slug` (human-readable, editable, format `{type}-{kebab-title}`). Service methods accept either via `corpusService.resolve(idOrSlug)` (`packages/lore/src/service/resolve.ts`).

**`bun:sqlite` is external to vitest** — `vitest.config.ts` marks `bun:sqlite` as an SSR external and excludes it from `optimizeDeps`. Tests that touch `SQLiteStore` must use `bun test`, not vitest. CLI loader (`packages/lore/src/adapters/cli/loader.ts`) is bun-only to isolate `bun:sqlite` from vitest-reachable utility modules.

**FTS5 escaping** (`escapeFtsQuery`, `store-shared.ts`) — each whitespace piece phrase-quoted, internal `"` doubled, so FTS5 operators are inert; empty input short-circuits before MATCH.

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
draft → in-review | approved (fast-track)
in-review → approved | draft
approved → active | archived | deprecated   # ⛔ approved → archived is LEGAL, direct
active → archived | deprecated
archived, deprecated → terminal (no outbound edge)
```

Editing an `approved` doc resets it to `draft` automatically — content/title AND `extra` — except the ledger knowledge sub-types (`assessment | retro | handoff | uat`), which are re-fast-tracked to `approved` in the SAME write, so an edit logs two versions at one timestamp and never enters the review queue. ⛔ Three `extra` writers bend that rule, and none of the three is a bug to fix: `lore ac set` demotes AND logs a version; **`lore ac add` does NOT demote** but logs one — so an approval certifies the AC set as of approval time, not the set a reader sees; **`lore phase add|rm` does NOT demote but LOGS a version** (`phase rename` likewise), per `adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan`, which overturned SPEC-023's dispensable-history clause while KEEPING phases soft groupings — the write contract itself sits in `phase-service.ts`'s and `ac-service.ts`'s own headers. ⛔ Phase mutations applied BEFORE that ADR left no row and cannot be reconstructed, so a plan's `lore log` is not a complete phase history. Pre-ADR record, superseded on the phase half only: `knowledge-five-findings-from-planning-the-bootstrap-fixpoint` §3; `knowledge-five-governance-findings-measured-while-closing-the` F6.

### MDX Placeholder Components (OutlineService)

Whitelisted components resolved at read time: `ChildrenOf`, `RecentDecisions`, `ActivePlans`, `ModuleTree`, `RelatedOf`, `Embed`, `HealthStats`. Unknown components are stripped with a warning (not an error).

### Type-specific Validation (CreateDocInput)

- `spec` and `task` require `parent_id`
- `adr` requires `extra.decision_status` (`proposed | accepted | deprecated | superseded`)
- `knowledge` requires `extra.sub_type` (`ideation | retro | research | reference`)
- `task` requires `extra.plan_id`

Enforced via Zod `superRefine` in `packages/core/src/schemas.ts`.

### Dogfooding: Skill/Tool Eval Log

Lore is built **through** the Lore-governed workflow (corpus chain + skills + gates): a discipline we skip here is one we cannot ask other teams to keep.

**⛔ Eval every skill/tool we depend on — never assume it is already optimal.** A broken, misleading, or sub-optimal skill/hook/agent/gate is a defect: fix it now, or course-correct and record the correct path.

**⛔ Boundary rule**: new findings go ONLY to the corpus (`lore create knowledge --sub-type retro`), plus at most a one-line standing lesson below. CLAUDE.md never carries incident narratives — they go stale. `docs/claude-md-archive/` is a FROZEN pre-2026-07-22 snapshot — never append.

**⛔ A lore defect is fixed at its MECHANISM ROOT and verified from a FRESH consumer install — never patched on whichever surface happened to expose it.** Two questions gate every fix: (1) *what mechanism made this possible?* — prose that "should have been followed" is not a mechanism, and a defect already covered by prose proves the prose layer is the wrong layer; (2) *would a project that just ran `lore init` + `lore setup` still hit this?* — if yes, it is not fixed. ⛔ A fresh install cannot REACH convergence/diff-shaped defects (removal, retirement, pruning): construct BOTH ends of the diff plus a live control, else the probe vacuously passes — `knowledge-retro-a-fresh-install-probe-vacuously-passes`. The fix MUST land on a surface that SHIPS (binary-side output/payload, or `assets/` SSOT + manifest), never only this repo's files, this machine's `~/.claude/`, or a hand-edited consumer config.

**Standing lessons** — one line each, scope keywords + a resolving slug, nothing restated. Verbatim text: `knowledge-evicted-from-root-claude-md-2026-08-24-the-16`, `knowledge-retired-from-root-claude-md-the-19-dogfooding`, `knowledge-retired-from-root-claude-md-2026-08-13-three-standing`; FROZEN pre-2026-07-22: `docs/claude-md-archive/dogfood-eval-log.md`.

- False oracles — exit-code-true vs. measured-the-right-thing; green control; harness-sees-its-own-copy. `knowledge-a-symlinked-node-modules-makes-the-green-control-pass`
- ⛔ A `grep` finding 0 in a file not confirmed `text` is NOT a measurement: ONE raw NUL makes BSD grep suppress every match SILENTLY and exit 1 — byte-identical to "absent". Count raw bytes. `knowledge-a-correction-asserting-an-oracle-s-strength-is-itself`
- ⛔ Oracle design: a vitest `-t` naming a missing block exits 0 all-SKIPPED, so filtered oracles MUST also require `Tests N passed`; a negative-only prose oracle needs a POSITIVE counterpart citing the new SSOT. `knowledge-a-dry-run-flag-that-does-not-exist-writes-the-files`
- ⛔ `export-spec-mirror.ts` parses ONLY `--check` (`--dry-run` is ignored, it WRITES) and write-mode does NOT reconcile bodies — only `lore export-docs --force` does; an MDX placeholder is mirrored EXPANDED, so drift returns on the next new doc. `knowledge-a-dry-run-flag-that-does-not-exist-writes-the-files`
- ⛔ A vitest run NEVER proves a symbol is exported — esbuild does not check named exports across modules, so importing a non-exported name is GREEN unless the test CALLS it. Only `tsc` (TS2459) or a call catches it; "both runners green" carries no export guarantee. `knowledge-under-vitest-importing-a-name-a-module-does-not`
- Eight pointer-less lessons, evicted verbatim, still normative — substring matchers, SSOT/asset parity, distribution oracles, worktree dispatch order, `spawnSync`/`set -e`, main-checkout actor, path-scoped commits, clean-tree verdicts. `knowledge-retired-from-root-claude-md-eight-pointer-less`
- ⛔ Nine standing lessons are UNENFORCED — each names the mechanism it still needs; `lore gate plan-close --explain` is the SSOT for the dropped plan-close copy. `knowledge-the-nine-unenforced-standing-lessons-evicted-from`
- Distribution-first: name the delivery surface or it does not exist for consumers. `adr-distribution-first-every-improvement-names-its-consumer`
- Spec close-outs write NOTHING to this file. `adr-claude-md-specs-section-is-pointer-only-per-spec-index`
- A new deterministic gate retroactively invalidates the back-catalog — budget the sweep + a written exemption in the SAME slice. `knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`
- Marker censuses over a self-documenting corpus over-match: anchor structurally + a second independent condition. `knowledge-the-substring-matcher-lesson-has-a-mirror-face-over`
- Red-suite triage: timeouts vs. assertion mismatches, isolation, read MEMORY not load average. `knowledge-load-average-is-the-wrong-instrument-for-is-this-red`
- ⛔ `lore ac set` demotes an approved spec to draft and hard-blocks EVERY descendant claim (`ac add` does not — see the asymmetry above); re-read spec status per dispatch, never from a batch-start snapshot. `knowledge-three-of-lore-s-own-outputs-misled-this-session-a`
- ⛔ A literal corpus count inside a governance doc is a claim with no oracle — cite the `lore status --json` field instead. `knowledge-three-of-lore-s-own-outputs-misled-this-session-a`
- ⛔ Readiness fields disagree: `lore feed`/`bootstrap` count RETRACTED tasks as ready, `lore ready` excludes them. `knowledge-lore-feed-s-readiness-line-counts-retracted-tasks`
- ⛔ An ATTESTED pass is not evidence of production wiring — split any AC whose prose names two layers; a surface AC's oracle MUST drive the surface. `knowledge-an-attested-pass-is-not-evidence-of-production-wiring`
- ⛔ An `assess` MAJOR can be exactly BACKWARDS — machine-check every finding that names a path; path existence is decidable, never a judgment. `knowledge-nine-findings-from-landing-the-mirror-id-unify-merge`
- ⛔ MEASURE a field/command before pinning an AC's oracle to it, and never pair that pin with a clause refusing the alternative — tightening an oracle can DESTROY it. `knowledge-five-governance-tooling-gaps-measured-while-resuming`
- ⛔ `lore ac list` counts by recording-task PLAN LINEAGE and IGNORES `ac_scope`; `oracle_generation` bumps only when `verify.command` changes. `knowledge-ac-coverage-counts-evidence-by-plan-lineage-and`
- ⛔ `--capture` NOW ATTESTS (SPEC-143 C5) and clears `lore done`'s floor, so the old "not attested" rule is FALSE for new rows — the floor asks presence, not provenance; only `verify` proves declared scope. `knowledge-lore-evidence-capture-now-clears-the-attested-floor`
- ⛔ RUN a structural oracle BEFORE declaring it as an AC — else the author's file list becomes the AC's blind spot and the AC certifies it as covered; the GENERIC needle is the load-bearing one. `knowledge-five-findings-from-planning-the-github-read-side-a`
- ⛔ A refusal branch on one config shape, absent on its neighbour, reads as "guarded" everywhere; a partial comparison is not an equality check — assert EQUALITY, not containment; a structural AC is only as wide as the file list it greps. `spec-the-retired-shape-refusal-message-has-two-byte-identical`

### AI Default Behavior by Caller Surface (SPEC-024)

AI is ON for human surfaces (`cli`, `http_cookie`) and OFF for agent surfaces (`agent` — signalled by `CLAUDECODE=1` / `CI=true` / `LORE_AI_DEFAULT=off` —, `mcp`, `http_token`), so `lore create` never nests a Claude call. Override per call with `--ai` / `--no-ai` (both → exit 2), or per surface via `ai.default_per_surface.<surface>` in `.lore/config.yaml`; resolved values in `lore status --json`. Full detection table: `lore get SPEC-024`.

### Implementation Status

⛔ Per-spec SSOT is the corpus, never a snapshot here: `lore get SPEC-0NN`, `lore list --type plan`. Evicted narrative: `knowledge-retired-from-root-claude-md-the-implementation-status`; FROZEN pre-2026-07-22: `docs/claude-md-archive/spec-implementation-notes.md`.

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

- `search` (FTS5) / `get` (`--resolve-mdx` expands placeholders) / `list --type` / `tree` / `pending` / `log` + `diff --from N --to M` / `status`. Flags: `--help` on each — never transcribed here.
- ⛔ The corpus is the ONLY spec index — read the governing spec (`lore get SPEC-0NN`, or `lore search`) before changing a module; exported mirrors live under `docs/requirements/{prd,spec,adr,knowledge,plan,task}/`, zero-padded 3-digit ids (`bun run mirror:export` / `check:spec-mirror`).
<!-- /auto:dynamic-context -->
