# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

⛔ Before hand-editing this file, read its content contract: `lore governance claude-md` prints what belongs here vs. the corpus, and the line/byte ceiling enforced by `lore status --check-claude-md`.

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
bun run test:changed [<base>]  # deterministic worktree oracle: transitive reverse-dep selection across BOTH runners (default base: merge-base main HEAD); --list to preview
                               # FOUR rules: changed-test, reverse-dep, binary-consumer (compiled dist/lore|LORE_BIN vs source INDEX_TS — `bun run build` first only for compiled), tree-scanning oracle (fires when a changed file is in THAT test's own scan scope). Universe `packages/**` + `scripts/**`. Full contract: the module header. ⛔ Residual: selection reads CONTENT MARKERS, so a subprocess/scan test naming none is invisible
                               # ⛔ loud-zero: a NON-EMPTY changed-file set that selects 0 tests exits 1 in BOTH `--list` and executing mode (never a silent green) — the ONLY legitimate 0-selection exit-0 is a genuinely EMPTY changed-file set

# Run a single vitest test file
bunx vitest run packages/lore/tests/unit/service/corpus-service.test.ts

# Run a single bun test file
cd packages/lore && bun test tests/unit/store/sqlite-store.bun.test.ts
```

**Test file convention**: Files ending in `.bun.test.ts` run under `bun test` only (they use `bun:sqlite`). All other `.test.ts` files run under vitest. Do not mix runners.

**Pre-push corpus gate**: `hooks/pre-push` runs three checks before every push — `lore status --check-tree --check-drift`, `lore audit --verify` (SPEC-081 G5), and `lore status --check-prd-budget` (SPEC-080 Phase 3, armed 2026-07-26) — fail-open when `lore`/`.lore/` absent; bypass with `--no-verify`. Byte-identical pair with `assets/project/pre-push` (parity-pinned; regen assets manifest on edit). After clone, activate with `git config core.hooksPath hooks`.

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

Editing an `approved` doc resets it to `draft` automatically — content/title AND `extra` — except the ledger knowledge sub-types (`assessment | retro | handoff | uat`), which are re-fast-tracked to `approved` in the SAME write, so an edit logs two versions at one timestamp and never enters the review queue. ⛔ The two AC writers are ASYMMETRIC, and a prior version of this line asserted they were not: `lore ac set` demotes an approved spec to `draft`; **`lore ac add` does NOT** — criteria can be appended to an approved spec indefinitely without re-entering review, so an approval certifies the AC set as of approval time, not the set a reader sees. Differential probe on a throwaway corpus, 2026-08-11 (add → still `approved`, set → `draft`, precondition asserted): `knowledge-five-findings-from-planning-the-bootstrap-fixpoint` §3.

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

**Standing lessons** — one line each, scope only. Full text: `knowledge-retired-from-root-claude-md-the-19-dogfooding`; pre-2026-07-22 history: `docs/claude-md-archive/dogfood-eval-log.md` (FROZEN).

- False oracles — exit-code-true ≠ measured-the-right-thing; six vectors, four mechanized, two open. `knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false`
- Contiguous-substring matchers degrade silently to no-match — key on lone tokens + independent negative conditions.
- SSOT↔installed asset pairs need content-parity assertions; manifest presence proves nothing.
- Every distribution pipe and gate-read field needs an install→visible / author→trip end-to-end oracle.
- Worktree dispatch: `bun install` FIRST; verify `git log` on the branch BEFORE merge+cleanup.
- The global `lore` symlinks into the main checkout's `dist/` — ⛔ never rebuild while an agent runs; merging ≠ releasing. `knowledge-the-global-lore-is-a-symlink-into-the-main-checkout-s`
- `subagent-stop-commit-guard.mjs` has one known harness-timing gap — probed sound, do NOT "fix" it.
- Static discipline belongs in CLAUDE.md layers, never in a hook (hooks carry computed state only).
- Escalation ≠ build: a twice-recommended mechanization triggers a VERIFICATION pass first.
- `spawnSync` on a growing `--json` payload needs explicit `maxBuffer`; ⛔ `set -e` is INERT in the agent shell — chain with `&&` and assert resulting state after every batch.
- `mode-$0.md` skills validate the mode against the known set BEFORE any `Read`.
- Checklists are a floor, not a ceiling — also ask what uncatalogued problem this session has.
- `lore assess --diff`: derive the range from the plan's own first task commit.
- Main-checkout oracle runs need `LORE_ACTOR=agent:main-orchestrator` — nothing enforces it.
- Distribution-first: name the delivery surface or it does not exist for consumers. `adr-distribution-first-every-improvement-names-its-consumer`
- Spec close-outs write NOTHING to this file. `adr-claude-md-specs-section-is-pointer-only-per-spec-index`
- In a shared checkout, commit PATH-SCOPED (`git commit -m "<msg>" -- <paths>`).
- A full-suite verdict requires a CLEAN tree at a named commit.
- A new deterministic gate retroactively invalidates the back-catalog — budget the sweep + a written exemption in the SAME slice. `knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`
- A backgrounded oracle's completion notice reports the SHELL's exit code — persist `$?` and read it back; a ceiling kill reports 143. `knowledge-a-backgrounded-command-s-completion-notice-reports`
- Human renders are lossy projections, and announcing the loss at ONE consumer leaves the shared seam lossy; list columns also truncate — key on the ID. `knowledge-lore-get-s-human-view-hides-extra-issue-report-so-a`
- Marker censuses over a self-documenting corpus over-match: anchor structurally + require a second independent condition. `knowledge-the-substring-matcher-lesson-has-a-mirror-face-over`
- Before blaming a red suite on the diff: timeouts ≠ assertion mismatches, check isolation, read MEMORY not load average. `knowledge-load-average-is-the-wrong-instrument-for-is-this-red`
- A threshold armed by one agent is calibrated against ITS base — a concurrent peer merge invalidates it, so re-run every armed gate on the merged tree AFTER the rebuild. `knowledge-a-newly-armed-threshold-is-calibrated-against-the`
- ⛔ An EMPTY output artifact is the same shape as a clean one — assert a positive trace of execution, and never put a `cd` in front of a measurement (zoxide shims it; `&&` then short-circuits silently). Seventh false-oracle vector. `knowledge-three-of-lore-s-own-outputs-misled-this-session-a`
- ⛔ `lore set <plan> --status archived` DOES evaluate the `plan-close` gate (`corpus-service.ts:2029`: `this.gateEnforcer.isEnabled("plan-close")`, and `resolveGateEnabled` returns `!== false` — enabled unless a config explicitly disables it) — a prior version of this line asserted the opposite and was false. The archival cascade that follows a passing gate is a SEPARATE, deliberately ungated data-integrity mechanism (irreversibly archives non-terminal children) — do not re-gate it; a vacuous gate PASS is the actual risk, not an absent gate. Measured 2026-08-10: `spec-governance-visibility-an-armed-gate-that-vacuously-passes` §B1.
- ⛔ Tightening an AC via `lore ac set` drops the spec to `draft` and hard-blocks EVERY descendant claim (`ac add` does not demote — see the asymmetry above) — re-read the spec's status immediately before each dispatch, never from a batch-start snapshot. Same doc.
- ⛔ A literal corpus count inside a governance doc is a claim with no oracle — cite the `lore status --json` field instead. A `pass_unfalsified` figure justifying a decision was off 20x. Same doc.
- ⛔ An ATTESTED pass is not evidence of production wiring: if the AC's command exercises the implementation layer while its prose promises a user-facing surface, attestation certifies an unreachable capability with the corpus's strongest evidence tier. Split any AC whose prose names two layers; a surface AC's oracle MUST drive the surface. Three instances in one session, all found AFTER attestation, 2 of 3 by `lore assess` — so assess is load-bearing, not advisory-in-practice. `knowledge-an-attested-pass-is-not-evidence-of-production-wiring`
- ⛔ `lore verify <plan>` with no `--ac`/`--task` runs EVERY declared script-mode AC, minting fresh `fail` rows for not-yet-implemented ones; always filter on a partially-complete plan. A silent gate pass, a count with no member list, an unfeedable checkpoint, and a mirror advertised as complete while 29% is missing are one defect in four costumes — an outcome the tool renders identically whether or not it is sound. `knowledge-four-governance-tooling-gaps-measured-while-resuming`
- ⛔ The anchor mutex is PLAN-SCOPED (`buildAnchorGateContext` ← `getPlanBundle`), and so is `lore ready`'s `anchor_conflicts` — a cross-plan collision is invisible to BOTH the gate and the pre-dispatch check, so `anchor_conflicts: []` with more than one active plan is NOT evidence of safety. Fix the gate and the report together, asserted by one oracle spanning two plans: either half alone looks complete. Also: a check that regenerates what it checks cannot fail, and neither can a TEST that repairs the tree before asserting — forbid both mechanically (hash before/after), never in prose. `knowledge-five-findings-from-planning-the-bootstrap-fixpoint`
- ⛔ The full suite EXPORTS into the live corpus (AC-FR-10's own text mandates the production corpus) while `spec-loop-e2e` asserts `.lore/` is clean ⇒ ANY corpus write reddens the next run until the mirror is re-exported and committed, and the guard misses mirror-content dirt entirely. Two sessions sharing one checkout also poison each other: a peer's non-gitignored broken fixture faked a `typecheck` red. `knowledge-nine-findings-from-landing-the-mirror-id-unify-merge`
- ⛔ An `assess` MAJOR can be exactly BACKWARDS — one read a rename's SOURCE side as the result and indicted a filename that same commit FIXED. Machine-check every finding that names a path before scoring it; path existence is decidable, never a judgment. Same doc.
- ⛔ MEASURE a field/command before pinning an AC's oracle to it, and never pair that pin with a clause REFUSING the alternative in the same round: pinning `lore status --json` (which surfaces `ai_defaults` but NOT arbitrary resolved config) while forbidding a hand-rebuilt merge left an AC with no runnable oracle at all. Tightening an oracle can DESTROY it. `knowledge-five-governance-tooling-gaps-measured-while-resuming`

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
