# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

# Run a single vitest test file
bunx vitest run packages/lore/tests/unit/service/corpus-service.test.ts

# Run a single bun test file
cd packages/lore && bun test tests/unit/store/sqlite-store.bun.test.ts
```

**Test file convention**: Files ending in `.bun.test.ts` run under `bun test` only (they use `bun:sqlite`). All other `.test.ts` files run under vitest. Do not mix runners.

**⛔ Never write to the repo's own `.lore/` corpus from tests or smoke checks.** The repo corpus is the team's live knowledge base. Any manual smoke test or e2e run that creates/edits docs MUST use a throwaway corpus (`mkdtemp` + `lore init`, cwd inside it) — see `packages/dashboard/tests/e2e/global-setup.ts` for the canonical pattern. Also never assume a server answering on port 8787 is yours: a stale `lore dashboard` serving the real corpus once absorbed an e2e write suite (2026-07-07 pollution incident — 6 foreign docs, corrupted export numbering).

## Architecture

### Layer Stack

```
packages/lore/src/adapters/cli/   ← citty CLI (default entry, 22 subcommands)
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

All feature specs live under `docs/requirements/spec/`. When implementing or changing behaviour in a module, read the relevant spec first.

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
- `SPEC-014` — Monorepo skeleton (Bun workspaces, @lore/core + @lore/lore + @lore/dashboard)
- `SPEC-015` — Dashboard read-only skeleton (Vite + React + shadcn; list/search/tree/detail)
- `SPEC-016` — Cookie auth via CLI-managed local bootstrap (`lore dashboard` + sessions table)
- `SPEC-020` — HTTP-backed AI provider (`ai.provider: "http"`) — Anthropic Messages API; `${ENV_VAR}` headers; for CI/team gateways where local `claude` binary is unavailable; CLI is still the default
- `SPEC-024` — Default --no-ai for agent and MCP execution paths (AI surface defaults)
- `SPEC-019` — AI assistance in `lore set` (`--regenerate` / `--refine` / `--refine-stdin`) and `lore link --infer`; extends SPEC-017 AI provider surface
- `SPEC-021` — `lore export-docs` reverse sync (corpus → .md files); `.lore/export-index.json` is **git-tracked** (team-shared ID map)
- `SPEC-022` — Dashboard write UI (create / edit / approve / link): six cookie-gated `/api/dashboard/*` write routes, CodeMirror 6 editor, If-Match optimistic concurrency + ConflictModal, History tab
- `SPEC-025` — Task execution workflow metadata: append-only oracle evidence (`extra.verification_evidence`), advisory claim lease (`extra.claim`, TTL computed read-side, no daemon), computed readiness over `blocks` links (`lore ready`, never stored); `lore claim` / `lore release` / `evidence`; 4 new MCP tools; claim/evidence badges on `lore tree` / `lore list --type task`
- `SPEC-026` — `lore assess <plan>` — AI plan-outcome assessment (LLM-as-judge feedback loop): judges a plan's evidence trail against its spec's ACs, persists a `knowledge` doc (`sub_type="assessment"`) linked to the plan via `informs`; `lore_assess` MCP tool; assess has no non-AI mode (config brake only, no built-in per-surface off)
- `SPEC-032` — **implemented 2026-07-06** — output-contract mechanization: `extra.spec_kind` (feature|tech|design; create-default `feature` in `_createImpl`, validated on BOTH create and `set()` paths), repo-root `lore.tree.yaml` arming `lore status --check-tree`, `renderResolvedToMarkdown` text-projection splice (CLI `get` non-raw + `export-docs` body — adapter-seam, NOT CorpusService; see `src/service/CLAUDE.md`), `lore migrate spec-kind --dry-run`, `lore ready` `upstream_unapproved` advisory
- `SPEC-034` — **implemented 2026-07-06** — structured review judgment + triage queue (PRD §14 R1): `JudgmentService`, `AIProviderService.judgeDoc`, deterministic pre-checks (core pure fn, run before LLM), `lore review <doc>` / `--pending` (deterministic-check-fail short-circuits to a reject judgment WITHOUT invoking the AI provider; otherwise the AI judge runs — same "no non-AI mode" surface-brake semantics as `lore assess`), `lore pending` triage badges (`[AI: approve 0.93]` / `[AI: escalate ✋NQ]` / `[unreviewed]`, `(stale)` suffix) + `--escalated` (fresh-escalation filter + blocking-question bullets), MCP `lore_review {id_or_slug, by}` + `lore_pending` `include_judgments` (23 MCP tools total)
- `SPEC-035` — **implemented 2026-07-06** — audit trail + calibration data (PRD §14 R1): audit half — `AuditService`, `lore audit` query/`--verify` (versions⋈audit completeness oracle, `audit.verify_since` config watermark) + MCP `lore_audit`, TaskWorkflowService claim/release/evidence audit writes, `details.version` on every audit writer; calibration half — calibration_records table, implicit version-pinned calibration capture on approve/reject, `lore calibration --stats` (Wilson lower bounds, disaggregated per doc_type × prompt_version, action-family verify join)
- `SPEC-039` — **implemented 2026-07-08** — trusted runner: attested evidence for script-mode ACs: `lore verify <plan> [--ac] [--task]` executes declared script-AC commands (Bun.spawn, detached process group, SIGTERM→5s→SIGKILL, per-AC `verify.script.timeout_ms` ?? `verify.default_timeout_ms` config), derives `result` from exit code (never caller-asserted), records evidence with `attestation {runner, exit_code, duration_ms, timed_out}` — OPTIONAL on `evidenceEntrySchema` (extractEvidence is whole-array fail-closed) and runner-issued only: public evidence write paths reject attestation-carrying input loud; `recordVerifiedEvidence` (TaskWorkflowService, not CLI/MCP-exposed) is the sole injection site. Target task: explicit `--task` > unique fresh-claim match (`resolveTargetTask` pure fn) > loud ambiguity error. MCP `lore_verify` (24 tools). `computeAcCoverage` carries `attested_pass/attested_fail`; `lore ac list` renders `⚑✔`; assess prompt annotates attested counts (`ASSESS_PROMPT_VERSION` 5). Launch failure (ENOENT) → err with NO evidence; nonzero exit/timeout → attested fail. Trust boundary: commands = npm-scripts trust level, env passthrough is a documented trade-off, no sandbox, no crypto tamper-proofing claimed.
- `SPEC-038` — **implemented 2026-07-08** — AC-as-code: structured acceptance criteria + oracle binding (PRD §14 input-quality hardening; ADR "AC-as-code"): `spec.extra.acceptance_criteria` (typed array, `verify` discriminated union script/ai/human; `acceptance.ts` in `@lore/core`), `ORACLE_KINDS` single-definition-site consolidation (3 copies → `task-workflow.ts`), evidence `ac_ref` (`lore evidence --ac`, MCP `lore_evidence_add.ac_ref`) with cross-entity validation via `resolveDeclaredAcIds` port (CorpusService-implemented, constructor-injected into TaskWorkflowService), `lore ac add/list/rm` (`AcService`), assess judge consumes the declared AC set (`ASSESS_PROMPT_VERSION` 3→4, out-of-set `ac_id` → hard error, no retry, no doc), structured-AC checklist in text projection (`lore get` non-raw + `export-docs`, `✔/✘/·` coverage prefixes from `computeAcCoverage`)
- `SPEC-042` — **implemented 2026-07-11** — session layer part 2: session registry + file-anchor claim safety (PRD §15 S3): derived (never-stored) session registry grouping FRESH claims by `(by, machine, worktree)` (`deriveSessions`, `@lore/core`), surfaced as `lore ready`'s plan-scoped `sessions[]`/`anchor_conflicts[]` and `lore bootstrap`'s corpus-wide `active_sessions`; typed `task.extra.file_anchors: string[]` (`normalizeFileAnchors`/`anchorsOverlap`, `packages/core/src/file-anchors.ts`) authored via `lore create task --anchor <path>` (repeatable) and `lore anchor add/rm/list <task>` (never `lore set --anchor` — deliberately not built, D3); `task-claim` gate gains the `noAnchorOverlap` predicate (`gate:task-claim:anchor-overlap` discriminator), evaluated UNCONDITIONALLY (not gated by upstream-spec presence) — a fresh claim whose declared anchors overlap another fresh, foreign sibling claim in the same plan is REJECTED at `lore claim`, feeding pack names the conflicting task/holder/paths plus a literal `lore release <slug> --by <holder> --force` recovery command; `lore claim --machine/--worktree` (machine auto-captured as `os.hostname()`, worktree ALWAYS explicit — never `process.cwd()` capture) with same-holder-fresh-refresh carry-forward (`buildTaskClaim`); `lore tree` claim badge gains `@branch`; MCP `lore_anchor_set` (28 tools total), `lore_claim`/`lore_create` gain `machine`/`worktree`/`file_anchors`. See "Concurrent Worktree Dispatch" below for the actor-identity discipline this predicate depends on.

## AI Default Behavior by Caller Surface (SPEC-024)

Lore detects which "caller surface" is invoking it and selects a sensible AI default:

| Surface | How Detected | AI Default | Why |
|---|---|---|---|
| `cli` | None of the agent signals below | **on** | Human in a terminal — SPEC-017 default preserved |
| `agent` | `CLAUDECODE=1` or `CI=true` or `LORE_AI_DEFAULT=off` | **off** | AI-invoked; skip claude-on-claude nesting |
| `mcp` | In-process flag set by `startMcpServer()` | **off** | MCP callers are always AI agents |
| `http_cookie` | Cookie session from `lore dashboard` | **on** | Human browser session |
| `http_token` | Bearer API token | **off** | Agent-issued token |

### Env-var Matrix (recommended values for AI agent environments)

If you are an AI agent using the Lore CLI:

```bash
# Recommended: suppress AI by default so lore create never triggers a nested Claude call.
# Any of these three env vars cause surface detection to return "agent":
export CLAUDECODE=1        # Claude Code sets this automatically
export CI=true             # CI runners set this automatically
export LORE_AI_DEFAULT=off # Explicit opt-out for any non-Claude agent
```

### Overriding the Default

```bash
lore create spec --title "My Spec" --ai      # Force AI on (any surface)
lore create spec --title "My Spec" --no-ai  # Force AI off (any surface) → editor
```

`--ai` and `--no-ai` are mutually exclusive; passing both exits with code 2.

Per-surface config override (in `.lore/config.yaml`):
```yaml
ai:
  default_per_surface:
    cli: false       # disable AI even for human terminal
    agent: true      # enable AI for agents (rare)
```

`lore status --json` exposes `ai_defaults: { cli, agent, mcp, http_cookie, http_token }` —
the resolved per-surface AI defaults for the current configuration.

## Implementation Status

Phase 1 (core + CLI + service layer) and Phase 2 (MCP server, HTTP server, Turso sync, telemetry, tree conformance, eval) are landed. Active work focuses on incremental hardening (escape paths, drift fixes, additional scenarios).

**Breaking change (retro follow-up item 8, defense-in-depth) — service-layer gate enforcement is now ON by default.** The four IoC vertical-slice gate checkpoints (`spec-create` / `spec-promote` / `plan-promote` / `task-claim`) previously existed ONLY behind `lore gate <checkpoint>`, a separate CLI pre-flight command an agent/CI hook shells out to BEFORE the real write — an MCP tool call, an HTTP dashboard route, or any direct-service caller that skipped the hook bypassed every checkpoint. `GateEnforcer` (`packages/lore/src/service/gate-enforcer.ts`) closes that gap: `CorpusService.create` (spec-create), `CorpusService.set`/`ReviewService.approve` (spec-promote, on the draft→approved transition), `ReviewService.approve` (plan-promote), and `TaskWorkflowService.claim` (task-claim) all now run the SAME `checkpointRegistry` predicates `lore gate` does — so `lore_create`/`lore_approve`/`lore_claim` (MCP), the HTTP dashboard write routes, and `lore create`/`lore approve`/`lore claim` (CLI) are all gated identically, regardless of caller. Disable a specific checkpoint per corpus via `workflow.gates.<checkpoint>.enabled: false` in `.lore/config.yaml` (same knob `lore gate` already reads). `GateEnforcer` is optional DI on the three affected services — every bare `new CorpusService(store)`-style unit-test construction stays ungated, unaffected by this change.

### Plan Phases (SPEC-023)

Plans support optional declared phases via `extra.phases: Array<{name, description?}>`. Tasks may reference a phase by name via `extra.phase: string`.

Key patterns:
- `lore phase add <plan> <name> [--description]` — declare a phase on a plan (exit 4 on duplicate)
- `lore phase list <plan>` — list declared phases
- `lore phase rm <plan> <name>` — remove (fails if tasks still reference it)
- `lore phase rename <plan> <old> <new>` — rename in plan + all referencing tasks
- `lore create task --phase <name> ...` — assign task to phase at creation time
- `lore list --type task --plan-id <plan> --phase <name>` — filter tasks by phase
- `lore tree <plan>` — groups tasks under phase headers when plan has phases declared
- `lore migrate phases [--dry-run]` — one-shot sweep: converts legacy singular `extra.phase` → `extra.legacy_phase` across all plan rows (idempotent)

Cross-entity validation: creating or updating a task with `extra.phase` validates the name against the parent plan's `extra.phases[]` at write time (`CorpusService._createImpl` / `set`). Unknown phase or plan with no phases → `VALIDATION_ERROR`.

### Task Execution Workflow (SPEC-025)

Task docs carry two new `extra` fields, both owned exclusively by `TaskWorkflowService` (never `CorpusService`):
- `extra.verification_evidence` — append-only oracle log (max 50 entries, `output_tail` ≤ 4000 chars). Written via `lore evidence`.
- `extra.claim` — advisory execution lease `{by, at, branch?}`; expiry is computed read-side against `workflow.claim_ttl_minutes` (config, default 120) — no daemon, no heartbeat. Written via `lore claim` / cleared via `lore release`.

Key patterns:
- `lore claim <task> [--by] [--branch] [--machine] [--worktree] [--steal]` — acquire/refresh the lease; fresh claim held by someone else → exit 5 (`CLAIM_CONFLICT`) unless `--steal`; `--machine` auto-captures `os.hostname()` when omitted, `--worktree` is ALWAYS explicit (SPEC-042 D2)
- `lore release <task> [--by] [--reason] [--force]` — clear the lease; non-holder requires `--force`
- `lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual|other> --command <cmd> --result <pass|fail> [--output-tail | --output-tail-file] [--by]` — append one oracle record; bumps doc version
- `lore ready <plan> [--json]` — computed readiness report over the plan's tasks + `blocks` links (never stored); a task is ready iff its status isn't archived/deprecated AND every blocker is archived. SPEC-042 additionally renders plan-scoped `sessions[]` (fresh claims grouped by `(by, machine, worktree)`) and `anchor_conflicts[]`; `--json` emits the FULL `ReadyReport` (`{records, sessions, anchor_conflicts}`) under `data.ready`, not a flat array
- `lore tree` / `lore list --type task` — render a `[claimed:by@branch (stale) ✔n/✘n]` badge on task rows (`@branch` present iff the claim declared one, SPEC-042 D7)
- Actor identity resolution (CLI): `--by` flag > `$LORE_ACTOR` env var > OS username. MCP tools (`lore_claim`, `lore_release`, `lore_evidence_add`, `lore_ready`) require `by` explicitly.

`task_status` was removed from `taskExtraSchema` (dormant, zero consumers) — superseded by computed readiness. Legacy docs still carrying it continue to validate (`.passthrough()`).

### AI Plan-Outcome Assessment (SPEC-026)

`lore assess <plan> [--diff <git-range> | --diff-file <path>] [--json] [--ai|--no-ai]` — closes the plan → execute → assess → improve loop. Sends the plan, its spec's ACs (when parented under a spec), every task's SPEC-025 evidence trail, and an optional code diff to the configured AI provider (LLM-as-judge); persists the structured result as a `knowledge` doc (`extra.sub_type = "assessment"`, `extra.assessment` is the Zod-typed SSOT, `content` is a deterministic rendering) with an `informs` link to the plan.

Key patterns:
- `CorpusService.getPlanBundle(planIdOrSlug)` assembles `{plan, spec?, tasks[]}` — read orchestration lives here (like `tree()`), not in AIProviderService (stays store-free) or the adapters (stay thin pipes).
- `AIProviderService.assessPlan(bundle, opts)` builds the judge prompt (materials truncated per `ai.assess.*` char budgets, truncated section names recorded in `judgment.truncated[]`), invokes the provider, extracts JSON (`extractAssessmentJson` in `@lore/core`, tolerates fences/prose-wrapping) and validates it — ONE corrective retry on malformed/invalid JSON (parse error embedded in a follow-up prompt), second failure → `AI_PROVIDER_ERROR` with a ≤500-char raw-output prefix and no document is created.
- **No non-AI mode** — unlike `set --regenerate`/`--refine`, the command name IS the AI intent (SPEC-024's built-in per-surface AI-off default for agent/mcp/http_token does NOT brake assess); only an EXPLICIT `ai.default_per_surface.<surface> = false` config override requires `--ai`. `--no-ai` always exits 2 (contradiction).
- `InMemoryAIProvider` gained a `sequence` mode (FIFO of scripted responses, one consumed per `generate()` call) so the corrective-retry path has a deterministic test oracle.

### Session Registry + File-Anchor Claim Safety (SPEC-042)

A "session" is DERIVED, never stored — the group of FRESH claims sharing the composite key `(by, machine, worktree)` (`deriveSessions`, `packages/core/src/session.ts`). `lore ready <plan>` surfaces this scoped to the plan (`sessions[]`) plus `anchor_conflicts[]`; `lore bootstrap` surfaces the corpus-wide equivalent as `active_sessions`. Neither is a new storage table — staleness/grouping is computed read-side against `workflow.claim_ttl_minutes`, same ethos as SPEC-025's claim lease.

Tasks carry a typed `extra.file_anchors: string[]` (repo-relative POSIX paths; a trailing `/` declares a directory scope) — the SSOT the `task-claim` gate reads. Author anchors via `lore create task --anchor <path>` (repeatable) or `lore anchor add|rm|list <task>` (read-modify-write, preserves `extra.claim`/`extra.verification_evidence`). There is deliberately no `lore set --anchor` — `CorpusService.set` replaces `extra` wholesale, which would silently delete other services' owned state.

The `task-claim` gate's `noAnchorOverlap` predicate runs UNCONDITIONALLY (not gated by upstream-spec presence, unlike `upstreamApproved`) — a claim whose declared anchors overlap a FRESH claim held by a DIFFERENT actor on another task in the SAME plan is rejected (`field: "gate:task-claim:anchor-overlap"`), and the feeding pack names the conflicting task/holder/overlapping paths plus a literal `lore release <slug> --by <holder> --force` recovery command. Disable only this predicate via `workflow.gates."task-claim".anchor_overlap.enabled: false` (the whole-checkpoint `workflow.gates."task-claim".enabled` knob still exists but also drops upstream-approval gating).

#### Concurrent Worktree Dispatch — Actor-Identity Discipline (SPEC-042 D10)

This closes the gap the pre-SPEC-042 "tasks with intersecting File Anchors must not run concurrently" rule left as a pure orchestrator-discipline convention: anchor conflicts are now REJECTED at `lore claim` itself (`gate:task-claim:anchor-overlap`) instead of relying solely on the dispatcher's own bookkeeping. This mechanism is only as strong as actor-identity discipline, because both the session-grouping key and the "different actor" overlap test key on `by`:

- Every dispatcher running sessions concurrently MUST assign each a **distinct actor identity** — convention `agent:<branch-or-task-slug>` — via `--by` or `$LORE_ACTOR` (worktree agents: export `LORE_ACTOR` in the dispatch bundle). If every concurrent session falls through to the same OS-username default, the anchor gate never fires and every agent collapses into one session row.
- **Claims are made BY THE IMPLEMENTER from inside its own worktree**, not by the orchestrator on the implementer's behalf — so the captured `machine`/`worktree` describe the actual work location (`--worktree` is always explicit; `process.cwd()` auto-capture was deliberately rejected, review U2 — an orchestrator's cwd would describe the dispatcher, not the worktree the work happens in).
- `lore ready <plan>` (or `lore_ready`) shows live `sessions[]` + `anchor_conflicts[]` before/during dispatch — use it to confirm who else is working and on what, instead of (or in addition to) manually tracking File Anchors from task descriptions.
- The pre-existing worktree-safety rules below (rebase-before-dispatch, per-file mutex queueing, immediate merge-after-return, marker-file persistence, retry/failure loop) are UNCHANGED by SPEC-042 — this section is an additive enforcement layer on top of them, not a replacement. Manual File-Anchor-intersection queueing by the orchestrator remains good practice as defense-in-depth (the gate only sees what a task actually *declares* via `extra.file_anchors`; an undeclared conflict is invisible to it).

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
