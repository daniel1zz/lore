# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Lore** — AI-native shared knowledge/memory platform for AI-first teams (3-5 people + multiple AI agents). Single binary (`lore`) with three adapters: citty CLI (default), MCP server (`--mcp-server`), and HTTP server (`lore serve`). Storage is local SQLite via `bun:sqlite` by default; with `sync.enabled` it switches to a Turso embedded replica (`@libsql/client`) for multi-machine visibility. Delivers a typed, navigable corpus of PRDs, specs, ADRs, plans, knowledge, and tasks, with MDX placeholder resolution, version history, review workflow, tree-structure conformance checks, telemetry, and v1 migration.

## Dogfooding: Skill/Tool Eval Log

Building Lore is itself run **through** the Lore-governed workflow (corpus chain + skills + gates). Dogfooding is our credibility source: if we don't follow best practice while building the tool that enforces best practice, we can't claim other teams should trust it.

**⛔ Consciously eval every skill/tool we depend on — never assume it is already optimal.** A broken, misleading, or sub-optimal skill/hook/agent/gate is a defect: fix it immediately (or course-correct + record the correct path).

**⛔ Boundary rule (2026-07-22)**: new findings are recorded ONLY in the lore corpus (`lore create knowledge --sub-type retro`), plus at most a one-line standing lesson below. CLAUDE.md never carries full incident narratives — they go stale (proven: a "not yet built" status here outlived the mechanism being built). `docs/claude-md-archive/` is a FROZEN pre-2026-07-22 snapshot — never append to it.

**Standing lessons** (full 33-row history: `docs/claude-md-archive/dogfood-eval-log.md`; several also as lore knowledge docs):

- **Four false-oracle vectors** — exit-code-true ≠ measured-the-right-thing: (1) mistyped AC paths — vitest silently drops non-matching path filters, PARTIAL match exits 0 (zero-match exits 1, loud); (2) under-match generally — after any path/`-t`-filtered run, assert the matched count (`Test Files N`); (3) wrong execution root — worktree `lore verify` ran against the main checkout pre-SPEC-063; (4) stale compiled binary — `.bun.test.ts` files spawning `dist/lore` need `bun run build` first. All four are now mechanized at the `lore verify` layer itself (SPEC-061 AC-061-9/10: under/zero-match + `-t` matched-case counts + `dist/lore` build-freshness precheck → `inconclusive`; SPEC-063: execution root) — but the lesson stands: trust markers prove a command ran, not that it measured the right thing.
- **Contiguous-substring assumption**: matchers/filters built from remembered phrases silently degrade to no-match ("no match + exit 0" is indistinguishable from "passed"); key on lone tokens + independent negative conditions.
- **SSOT↔installed asset pairs** need content-parity or content-invariant assertions — manifest presence alone makes "fixed in both copies" unverifiable (bidirectional divergence observed).
- **Consumer/end-to-end audits**: a writer whose reader was retired, a reader without a writer, a roster map with renamed types, a gate demanding a field no surface can author — all fail SILENT. Every distribution pipe and every gate-read field needs an install→visible / author→trip end-to-end oracle.
- **Worktree dispatch**: `bun install` FIRST in any fresh worktree (module resolution silently walks up into the main checkout — oracles test stale source); verify `git log` on the branch BEFORE merge+cleanup ("Already up to date" on a branch that should carry work = STOP, recover first).
- **Subagent termination discipline is mechanized** (`subagent-stop-commit-guard.mjs`): prose reinforcement measurably failed 4×; a subagent's final message must be a completion/blocked report and its work committed — "completed work" and "committed work" are different states. Known gap: a LIVE background child at hook-fire time can slip past the guard (harness timing, not guard logic — probed sound; do NOT "fix" it) — the git-log-before-merge backstop above remains necessary.
- **Session-start hooks inject computed state, never do blocking work**; static discipline lives in CLAUDE.md layers, hooks carry only dynamic state.
- **Escalation ≠ build**: a twice-recommended mechanization triggers a VERIFICATION pass first, not a build pass — check whether the underlying tool already enforces the invariant (non-force `git worktree remove` needs no guard; git itself refuses).
- **`spawnSync` capturing a growing `--json` payload MUST set explicit `maxBuffer`** (1 MiB default silently truncates); never discard stderr on batch corpus writes; pass multi-arg lore calls as explicit quoted args, never pair-strings.
- **`mode-$0.md` skill pattern**: pass the mode name as the FIRST token; skills must validate the mode against the known set BEFORE any `Read`.
- **Checklists are a floor, not a ceiling**: after judging every listed invariant, ask what uncatalogued problem this session has (structured-checklist tunnel vision underperforms an unstructured reviewer on unlisted omissions).
- **`lore assess --diff`**: derive the range from the plan's own first task commit — a too-wide range silently converts unrelated work into false scope-drift findings.
- **Serialize Playwright suites** against a fixed dev-server port — concurrent runs contend and produce phantom "browser has been closed" failures.
- **Main-checkout oracle runs need actor identity** (`LORE_ACTOR=agent:main-orchestrator`) — mechanized as the resolveActor OS-fallback advisory (SPEC-035 hotfix).
- **Spec close-outs append ONE index line to CLAUDE.md, never the as-built narrative** — the Specs section re-bloated 26.7KB→52.8KB within 4 days of the boundary-ADR compression via per-spec close-out paragraphs; detail goes to the corpus (spec doc / assessment / retro).

## Commands

```bash
bun run dev               # Run from source (packages/lore/src/index.ts)
bun run build             # Compile to dist/lore binary (bun build --compile)
bun run typecheck         # tsc --noEmit for all packages + scripts

# Tests — two runners, both must pass
bun run test:vitest       # bunx vitest run — covers non-bun:sqlite files
bun run test:bun          # cd packages/lore && bun test .bun.test
bun run test              # both runners in sequence

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
packages/lore/src/adapters/cli/   ← citty CLI (default entry, 31 subcommands)
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

**Result<T, LoreError>** — no exceptions cross service boundaries. Every service method returns `Promise<{ ok: true; value: T } | { ok: false; error: LoreError }>`. Use `ok()` and `err()` helpers from `@lore/core`. 13 error codes in the discriminated union.

**StoreInterface is async** — methods return `Promise<Result<T, LoreError>>`. This is the contract both `SQLiteStore` (wraps sync `bun:sqlite` calls) and `TursoStore` (`@libsql/client`, natively async) implement. `InMemoryStore` is the test double. Services depend on `StoreInterface`, never on a concrete store.

**Store selection (D-007)** — `createApp(dbPath, config?)`:
- No config / `sync.enabled !== true` → `SQLiteStore` (local-only, returned directly as `App`).
- `sync.enabled: true` + `remote_url` + valid `LORE_SYNC_TOKEN` env var → `TursoStore` (embedded replica) wrapped in `Result<App>`.
- Sync enabled but credentials missing or TursoStore construction fails → `err(STORE_ERROR)`. **No silent fallback** to SQLiteStore — offline writes must not land only-local.

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

Editing content/title on an `approved` doc resets it to `draft` automatically.

### MDX Placeholder Components (OutlineService)

Whitelisted components resolved at read time: `ChildrenOf`, `RecentDecisions`, `ActivePlans`, `ModuleTree`, `RelatedOf`, `Embed`, `HealthStats`. Unknown components are stripped with a warning (not an error).

### Type-specific Validation (CreateDocInput)

- `spec` and `task` require `parent_id`
- `adr` requires `extra.decision_status` (`proposed | accepted | deprecated | superseded`)
- `knowledge` requires `extra.sub_type` (`ideation | retro | research | reference`)
- `task` requires `extra.plan_id`

Enforced via Zod `superRefine` in `packages/core/src/schemas.ts`.

## Specs

All feature specs live under `docs/requirements/spec/`; the corpus is the SSOT — find any spec via `lore search "SPEC-0NN"` or `lore get <spec-slug>`. When implementing or changing behaviour in a module, read the relevant spec first.

⛔ **Entry contract** (per `adr-claude-md-carries-only-standing-discipline-histories-archive`): each spec gets ONE index line here — scope keywords only, never as-built narrative (deviations, byproducts, fix dates → corpus: spec doc / assessment / retro). The pre-2026-07-26 verbose entries are frozen verbatim in corpus doc `knowledge-claude-md-specs-section-as-built-narratives-frozen`; SPEC-025+ implementation-time notes also in `docs/claude-md-archive/spec-implementation-notes.md`.

- `SPEC-001` — service layer + DI pattern
- `SPEC-002` — corpus schema, types, lifecycle
- `SPEC-003` — CLI adapter (22 commands, exit codes, output format)
- `SPEC-004` — PRD-as-living-root (MDX placeholders)
- `SPEC-005` — review workflow
- `SPEC-006` — version history
- `SPEC-007` — v1 migration
- `SPEC-008` — MCP adapter (16 `lore_*` tools)
- `SPEC-009` — Turso embedded-replica sync (D-007 fail-loud)
- `SPEC-010` — HTTP API + API key auth
- `SPEC-011` — HTTP route layout
- `SPEC-012` — telemetry (JSONL, opt-in)
- `SPEC-013` — FTS5 resilience + eval scenarios
- `SPEC-014` — monorepo skeleton (Bun workspaces, @lore/core + @lore/lore + @lore/dashboard)
- `SPEC-015` — dashboard read-only skeleton (Vite + React + shadcn; list/search/tree/detail)
- `SPEC-016` — cookie auth via CLI-managed local bootstrap (`lore dashboard` + sessions table)
- `SPEC-019` — AI assistance in `lore set` (`--regenerate` / `--refine` / `--refine-stdin`) and `lore link --infer`
- `SPEC-020` — HTTP-backed AI provider (`ai.provider: "http"`) — Anthropic Messages API; `${ENV_VAR}` headers
- `SPEC-021` — `lore export-docs` reverse sync (corpus → .md files); `.lore/export-index.json` is git-tracked
- `SPEC-022` — dashboard write UI: cookie-gated write routes, CodeMirror 6, If-Match + ConflictModal, History tab
- `SPEC-024` — default --no-ai for agent/MCP execution paths (AI surface defaults; see section below)
- `SPEC-025` — task execution workflow: append-only `extra.verification_evidence`, advisory claim lease, computed readiness
- `SPEC-026` — `lore assess <plan>`: LLM-as-judge plan-outcome assessment → assessment knowledge doc
- `SPEC-032` — output-contract mechanization: `extra.spec_kind`, `lore.tree.yaml` arms `--check-tree`, `upstream_unapproved` advisory
- `SPEC-034` — structured review judgment + triage: `JudgmentService`, deterministic pre-checks before the LLM, triage badges
- `SPEC-035` — audit trail + calibration: `AuditService`, `lore audit --verify`, Wilson bounds (`lore calibration --stats`)
- `SPEC-038` — AC-as-code: typed `spec.extra.acceptance_criteria` (script/ai/human), `lore ac add/list/rm`, evidence `ac_ref`
- `SPEC-039` — trusted runner `lore verify`: attested exit-code-derived evidence, env allowlist, command-provenance approval
- `SPEC-042` — session registry + file-anchor claim safety: derived sessions, `extra.file_anchors`, anchor-overlap rejected at claim
- `SPEC-043` — bi-temporal invalidation: `extra.validity`, `lore invalidate` sole writer, `--supersedes`
- `SPEC-044` — staleness probes: `lore review --staleness`, report-only escalation with literal repair command
- `SPEC-045` — doc-code drift oracle: `spec.extra.code_anchors`, `lore status --check-drift` (exit 3), `lore anchor add/rm/list`
- `SPEC-046` — distribution part 1: `assets/` SSOT tree + `lore setup` installer, vendored skills, auto-registered governance hooks
- `SPEC-047` — session seat auto-briefing: SessionStart hook detects linked worktree, redirects bootstrap cwd to main checkout
- `SPEC-048` — distribution part 2: npm single-platform publish, TTY postinstall nudge, Bun fd1 truncation fix
- `SPEC-049` — gate denials carry the feeding pack: `GateEnforcer` renders checkpoint `feed` into the VALIDATION_ERROR message
- `SPEC-050` — gate hooks cross-corpus false-deny fix: `TARGET_CWD` parsing, lookup-anomaly fail-open, command-position triggers
- `SPEC-051` — CLI strict flags: undeclared flags rejected exit 2, one seam wraps all commands
- `SPEC-052` — AC-quantifiability gate: `lintAcQuantifiability` at `lore ac add` + spec-create/spec-promote
- `SPEC-053` — AI-advisory AC-vagueness supplement on `lore review <spec>` (advisory only, never decision-driving)
- `SPEC-054` — UAT-verdict-as-plan-close-gate: `lore uat record/show` (sole writer `UatService`), opt-in `extra.requires_uat`
- `SPEC-055` — requirement→AC completeness oracle: `prd.extra.requirements`, `lore requirement add/list/rm`, `ac add --covers`
- `SPEC-056` — phase execution model: `phase` doc type (migration-created only), `PhaseWorkflowService`, claim/evidence dispatch by type
- `SPEC-057` — two-tier worktree seat model: `lore seat enter/list/resume/remove` over injected `GitPort`
- `SPEC-058` — verification profiles: per-spec_kind oracle-coverage + `min_acs` floors on spec-promote (profile-aware in service AND `lore gate` CLI pre-flight), `requiresUat` on plan-promote
- `SPEC-059` — requirement-layer quantifiability lint: shared `lintStatement`, enforced at `lore requirement add`
- `SPEC-060` — `lore setup --project` scaffold completion: repo ledger + backups, `--uninstall` via ledger, root CLAUDE.md stub
- `SPEC-061` — attestation completeness guard: under/zero-match + `-t` matched-case counting + `dist/lore` build-freshness → runner-issued `inconclusive`
- `SPEC-062` — config write layer: `ConfigService` (validate-then-write, CAS, audit), `CONFIG_DENY_KEYS` structurally unwritable over HTTP
- `SPEC-063` — verify execution-root correctness under linked worktrees (`resolveVerifyExecutionRoot`, attested `execution_root`)
- `SPEC-064` — dashboard Settings UI: two-scope config editing (team vs machine) with precedence + blast-radius disclosure
- `SPEC-065` — CLI ergonomics: unique ID-prefix resolution in `resolveDoc` (all surfaces), `lore create task` flag aggregation
- `SPEC-066` — git-safety-gate heredoc awareness: `stripHeredocs` before segmentation, fail-closed fallback to raw text
- `SPEC-067` — AI-surface robustness: 180s claude-cli timeout, fail-loud partial provider entries, truncation-aware assess confidence
- `SPEC-068` — CJK-aware slugify (lazy pinyin-pro via `@lore/core/node`) + `lore set --slug` repair path; compiled-binary e2e pinned
- `SPEC-069` — attestation floor on plan-close (plan-level `extra.attestation_exempt` opt-out) + ad-hoc planless tasks (`lore create task --adhoc` / `--linkage`, `lore ready --adhoc`)
- `SPEC-070` — deterministic task dispatch bundle: `lore feed task-start` (derivation in CLI wiring, render-only flow, `workflow.task_feed.*` budgets)
- `SPEC-071` — execution liveness: session-tier actor resolution (`agent:session-<id8>`), evidence auto-renews same-holder claims, `active_plans[].last_activity_at` (AC ids stay `AC-069-*`)
- `SPEC-072` — version snapshots capture `slug` (migration-007, absence-tolerant; `lore restore` never restores slug)
- `SPEC-073` — strict-flag hardening: single-dash multi-char tokens fail loud exit 2 with `Did you mean --X?`; usage renders aliases double-dash
- `SPEC-075` — dashboard adjudication workbench + route telemetry: core `evidence-panel.ts` projection, `GET /api/evidence-panel/:id`, AdjudicationBar, triage keyboard
- `SPEC-076` — distribution integration: embedded assets manifest + tree digest, per-asset `ownership`, five-state `planUpdate`, `lore setup --check`, diverged-skip converge, marker-section CLAUDE.md rewrite
- `SPEC-077` — dashboard execution read surface: `/execution` route + `GET /api/phase-status/:plan`; execution verbs stay CLI-only
- `SPEC-078` — dashboard multi-project: machine-config `dashboard.projects` mounts, `MountRegistry`, `/api/p/:name/*` rewrite shim, machine-scope auth
- `SPEC-079` — audit hardening: link/unlink/tree-fix audit provenance, `--by` actor fidelity across surfaces, tamper-evident audit hash chain + `lore audit anchor`
- `SPEC-080` — PRD-as-outline: root PRD body = projection of `prd.extra.outline[]` (sole writer `lore outline`), `domain-overview` spec kind, `lore status --check-prd-budget`, plan-close domain-doc sync predicate
- `SPEC-081` — audit hardening part 2 (AC ids `AC-080-*`): `gate_skipped` audit on config-disabled/env-bypass, pre-push `lore audit --verify` (parity-pinned pair), genesis-row tamper pin
- `SPEC-083` — governance prose runtime injection: `lore governance` verb replaces the installed corpus-workflow.md (retirement SSOT `RETIRED_FROM_INSTALL_PATHS`)
- `SPEC-085` — seat-briefing runtime injection: `lore governance --seat-briefing` (raw template, hook substitutes placeholders), Phase D spawns the verb, `governance/` install dir retired entirely; npm packaged-asset list stays install-set-independent
- `SPEC-080 (bootstrap-injection projection)` — tier-1 session-start injection via pure `buildBootstrapInjection` + `lore bootstrap --injection`, hook Phase E shape-blind pipe (⚠ renumber pending — triple-080 collision, see `knowledge-triple-spec-080-numbering-collision-across-concurrent`)

## AI Default Behavior by Caller Surface (SPEC-024)

Lore detects which "caller surface" is invoking it and selects a sensible AI default:

| Surface | How Detected | AI Default | Why |
|---|---|---|---|
| `cli` | None of the agent signals below | **on** | Human in a terminal — SPEC-017 default preserved |
| `agent` | `CLAUDECODE=1` or `CI=true` or `LORE_AI_DEFAULT=off` | **off** | AI-invoked; skip claude-on-claude nesting |
| `mcp` | In-process flag set by `startMcpServer()` | **off** | MCP callers are always AI agents |
| `http_cookie` | Cookie session from `lore dashboard` | **on** | Human browser session |
| `http_token` | Bearer API token | **off** | Agent-issued token |

AI agents using the Lore CLI should export one of `CLAUDECODE=1` / `CI=true` / `LORE_AI_DEFAULT=off` so `lore create` never triggers a nested Claude call. Override per call with `--ai` / `--no-ai` (mutually exclusive; both → exit 2), or per surface via `ai.default_per_surface.<surface>` in `.lore/config.yaml`. `lore status --json` exposes the resolved `ai_defaults`.

## Implementation Status

Phase 1 (core + CLI + service layer) and Phase 2 (MCP, HTTP, Turso sync, telemetry, tree conformance, eval) are landed; active work is incremental hardening. Full mechanism subsections are archived verbatim in `docs/claude-md-archive/spec-implementation-notes.md` (§Implementation Status); per-spec SSOT via `lore get <spec-slug>`. Operational essentials:

- **Service-layer gate enforcement is ON by default** — `GateEnforcer` runs the same `checkpointRegistry` predicates as `lore gate` inside `CorpusService.create`/`set`, `ReviewService.approve`, `TaskWorkflowService.claim` — so CLI, MCP, and HTTP dashboard writes are gated identically. Per-checkpoint knob: `workflow.gates.<checkpoint>.enabled: false`. Optional DI: bare `new CorpusService(store)` test constructions stay ungated.
- **Plan phases (SPEC-023)**: `lore phase add/list/rm/rename <plan>`, `lore create task --phase`, `lore tree` groups by phase; `extra.phase` is validated against the parent plan's `extra.phases[]` at write time (unknown → `VALIDATION_ERROR`).
- **Task workflow (SPEC-025)**: `extra.verification_evidence` (append-only, max 50 entries, `output_tail` ≤ 4000) + `extra.claim` advisory lease (expiry computed read-side vs `workflow.claim_ttl_minutes`, default 120; no daemon) — both owned exclusively by `TaskWorkflowService`, never `CorpusService`. `lore claim` (foreign fresh claim → exit 5 `CLAIM_CONFLICT` unless `--steal`; `--worktree` ALWAYS explicit) / `lore release` (non-holder needs `--force`) / `lore evidence` / `lore ready` (computed over `blocks` links, never stored). Actor resolution: `--by` > `$LORE_ACTOR` > OS username; MCP tools require `by` explicitly.
- **Sessions + file anchors (SPEC-042)**: a "session" is DERIVED, never stored — fresh claims grouped by `(by, machine, worktree)`; surfaced via `lore ready` (`sessions[]`/`anchor_conflicts[]`) and `lore bootstrap` (`active_sessions`). `extra.file_anchors` authored via `lore create task --anchor` / `lore anchor add|rm|list` — deliberately NO `lore set --anchor` (`set` replaces `extra` wholesale). The `noAnchorOverlap` gate predicate runs UNCONDITIONALLY; it is only as strong as actor discipline: concurrent dispatchers MUST assign each agent a distinct `LORE_ACTOR=agent:<branch-or-slug>` (all falling to the same OS username → the gate never fires), and claims are made BY THE IMPLEMENTER from inside its own worktree, never by the orchestrator on its behalf. Undeclared anchors are invisible to the gate — manual intersection queueing stays as defense-in-depth.
- **Invalidation (SPEC-043)**: `ValidityService.invalidate` is the SOLE validity writer (`CorpusService.set` rejects validity patches, naming `lore invalidate`); list/search reads filter invalidated docs by default (`--include-invalid` restores, badged), direct-address reads (get/feed/tree/export) ALWAYS show the banner instead; `--supersedes` half-failure is LOUD with the exact repair command.
- **Staleness probes (SPEC-044)** are on-demand, report-only (never auto-invalidate); **`lore assess` (SPEC-026)** has no non-AI mode and one corrective JSON retry — details in the archive.

The v1 predecessor at `/Users/apple/.claude/docman-mcp` remains frozen. Do not carry over its schema or API shape — v2 is greenfield.

<!-- auto:module-index -->
## Module Index

Module-specific context lives alongside the code:

- [`@lore/core`](packages/core/src/CLAUDE.md) — types, Result/LoreError, Zod schemas, lifecycle rules, config, telemetry
- [`packages/lore/src/service`](packages/lore/src/service/CLAUDE.md) — six stateless services, all return `Promise<Result<T, LoreError>>`
- [`packages/lore/src/store`](packages/lore/src/store/CLAUDE.md) — async StoreInterface + SQLite / Turso / InMemory + FTS5 escape
- [`packages/lore/src/adapters/cli`](packages/lore/src/adapters/cli/CLAUDE.md) — citty CLI, 22 subcommands, exit-code mapping
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
<!-- /auto:dynamic-context -->
