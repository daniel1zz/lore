# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Lore** — AI-native shared knowledge/memory platform for AI-first teams (3-5 people + multiple AI agents). Single binary (`lore`) with three adapters: citty CLI (default), MCP server (`--mcp-server`), and HTTP server (`lore serve`). Storage is local SQLite via `bun:sqlite` by default; with `sync.enabled` it switches to a Turso embedded replica (`@libsql/client`) for multi-machine visibility. Delivers a typed, navigable corpus of PRDs, specs, ADRs, plans, knowledge, and tasks, with MDX placeholder resolution, version history, review workflow, tree-structure conformance checks, telemetry, and v1 migration.

## Dogfooding: Skill/Tool Eval Log

Building Lore is itself run **through** the Lore-governed workflow (corpus chain + skills + gates). Dogfooding is our credibility source: if we don't follow best practice while building the tool that enforces best practice, we can't claim other teams should trust it. That includes a standing discipline:

**⛔ Consciously eval every skill/tool we depend on — never assume it is already optimal.** When a skill/hook/agent/gate we invoke turns out to be broken, misleading, or sub-optimal, treat it as a defect: fix it immediately (or course-correct + record the correct path), and log the finding in the table below so the next session inherits the knowledge. Systemic learnings may additionally become a `lore create knowledge --sub-type retro|research`; this table is the always-in-context quick reference (CLAUDE.md is read every session).

| Date | Skill/Tool | Finding | Status / Correct path |
|---|---|---|---|
| 2026-07-16 | `product` skill (`~/.claude/skills/product`) | Invoked as `product update` → SKILL.md:8 templated `Read references/mode-$0.md` → `mode-update.md` does not exist (404). `update` is **not** a defined mode; the mode table only lists ideation/discovery/prd/ux-research/roadmap/tech-assessment. Robustness gap: SKILL.md dangles a guaranteed-404 `Read` for any unknown mode with no validation/fallback. | Course-corrected: **updating a living PRD uses `prd` mode** (`mode-prd.md` explicitly handles "PRD UPDATE (existing PRD being revised)", lines 13/105/179). **FIXED 2026-07-16 (owner greenlight)**: SKILL.md now validates `$0` against the known-mode set BEFORE any `Read` and routes unknown/empty modes to AskUserQuestion; explicitly documents "no `update` mode — living-PRD updates are `prd` mode". |
| 2026-07-16 | `product` skill Phase 2 vs `pre-no-general-agent-gate` hook | `mode-prd.md` Phase 2 says "Launch 5 parallel subagents … use `Agent` tool" without a `subagent_type`; defaulting to `general-purpose` is hard-blocked by this environment's `pre-no-general-agent-gate.mjs` (`No bypass available`). The prescribed stakeholder-review pattern is incompatible with the local subagent gate out of the box. | Course-corrected: dispatch the stakeholder review via an allowed specialized type — used **`lore-reviewer`** (read-only, review-natured, corpus-aware), each prompt explicitly overriding its code-review framing to a PRD-section stakeholder lens. **FIXED 2026-07-16 (owner greenlight)**: `mode-prd.md` Phase 2 now mandates an explicit `subagent_type` (read-only reviewer-shaped type, e.g. `lore-reviewer`), never the `general-purpose` default. |
| 2026-07-16 | Global `handoff` skill (`~/.claude/skills/handoff` → `.agents/skills/handoff`) | Parallel NON-lore handoff mechanism: compacts a conversation into a single markdown FILE (pairs with a `/pickup` that was not even installed), bypassing the corpus SSOT; its description still referenced the RETIRED DocMan (`docman-session`) and its trigger phrases ("交接/保存进度/handoff") collide with the lore-native flow. Zero references from any other global config/hook/skill. | **RETIRED (owner decision 2026-07-16, "最彻底的")**: symlink removed from `~/.claude/skills/` (source preserved at `~/.agents/skills/handoff`, reversible). Canonical flow is lore-native SPEC-041 S2 everywhere: `lore handoff` → corpus doc → SessionStart bootstrap injection / `lore feed session-resume`; non-lore projects should `lore init` first. All four pieces (CLI verb, governance snippet, session-start hook, lore-session skill) ship in SPEC-046 `assets/`. |
| 2026-07-16 | `lore-gate-g1-spec-create.sh` hook (ours) | Hook statically parses the raw Bash command string; a `--content-file "$SP/spec-046.md"` path via an UNEXPANDED shell variable is unreadable to the hook → CONTENT empty → false `MISSING_SKELETON` deny on a fully-conformant spec. | Course-corrected: pass **literal absolute paths** to `--content-file` in `lore create` commands (no shell vars). **FIXED 2026-07-16 (owner greenlight)**: on an unreadable `--content-file` the hook now logs `UNRESOLVED_CONTENT_FILE` to stderr and FAILS OPEN (service-layer GateEnforcer still gates the real resolved content) instead of running the gate with empty content and emitting a false `MISSING_SKELETON` — applied to all 4 copies (assets/hooks + assets/project SSOT, repo hooks/, installed ~/.claude/hooks), 10/10 hook regression tests pass. |
| 2026-07-17 | `session-start-resume.mjs` Phase F (test health) + root `vitest.config.ts` | Two stacked defects exhausted machine memory (16GB): (1) hook ran the FULL vitest suite on every session start via `spawnSync(..., {timeout: 30000})` — on timeout Node only signals the direct bash child, orphaning every vitest fork worker (observed: 11 orphaned `node (vitest N)` processes at full CPU for ~1h, across two batches, PPID=1). (2) `vitest.config.ts` capped workers via `poolOptions.threads.maxThreads: 4`, but vitest 2+ defaults `pool` to `'forks'` (Tier S: resolveConfig `resolved.pool ??= 'forks'`), so the cap silently NEVER applied — every run forked one worker per CPU (8, ~200-300MB RSS each). Overlapping suite runs (session-start health check + `lore verify` script-ACs + manual `bun run test`) multiplied both. | **FIXED 2026-07-17**: config → pool-agnostic top-level `maxWorkers: 4` (fork count directly observed at 4 during a live run; `VITEST_MAX_WORKERS` env still overrides); hook Phase F → detached process-group spawn + `SIGKILL(-pid)` on timeout + `VITEST_MAX_WORKERS=2` bound during the health-check window + orphan-kill regression test (hook suite 18/18); applied to BOTH live copies (installed `~/.claude/hooks/` + `assets/hooks/` SSOT). Orphans killed. Lesson: a worker cap under `poolOptions.<wrong-pool>` is dead config — verify the active pool before capping. **Same-day follow-up**: process-COUNT caps alone still let each vitest process balloon to Node's 64-bit default heap ceiling (~4GB observed per instance) — added per-worker heap cap `poolOptions.forks.execArgv: ["--max-old-space-size=1536"]` (verified in-worker via a throwaway `v8.getHeapStatistics().heap_size_limit` oracle test) + main-process cap `NODE_OPTIONS=--max-old-space-size=2048` on the `test:vitest` script and the hook's health-check env (bun subprocesses tolerate the env var, integration suite 122/122). Worst case per run is now ~4×1.5GB workers + 2GB main, and a single leaky test file OOMs LOUD naming itself instead of silently swelling. |
| 2026-07-17 | `session-start-resume.mjs` context-channel unification (owner decision "统一") | Static content was double-channeled: (1) Phase C injected `~/.claude/prompt/global-instructions.md` (corpus-workflow discipline, 3.1KB, a personal zh fork of `assets/governance/corpus-workflow.md`) via hook every session while native CLAUDE.md is the designated home for static discipline (zz-init-context philosophy: files for static knowledge, hooks for dynamic state); (2) the Phase C subagent-roster block duplicated the harness's NATIVE custom-agent listing (~1KB/session, both visible in one session's context). | **UNIFIED 2026-07-17 (owner greenlight)**: corpus-workflow content folded into `~/.claude/CLAUDE.md` (Lore section expanded), prompt file renamed `.retired-20260717` (Phase C fail-opens on absence — zero code change needed for that half; the phase itself is KEPT for `lore setup`-provisioned machines); roster block DELETED from the hook (both copies: installed + `assets/hooks/` SSOT), `AGENTS_DIR` const retained (Phase D derives claude-dir from it). Hook now injects ONLY dynamic state (seat / bootstrap / test-health), per-session injection ~9KB → ~4.7KB. Tests 16/16 (roster tests replaced by a no-roster REGRESSION assertion). Principle: static discipline → native CLAUDE.md layers; hooks → per-session computed state only. |
| 2026-07-17 | Full hook-suite review (all `~/.claude/hooks/` + vendored `assets/hooks/`) | Six findings: (1) 3 orphan hook FILES never mounted in any settings (`gitnexus-augment/reindex`, `pre-skill-whitelist-gate`); (2) lore gates g1–g4 DOUBLE-MOUNTED for this repo (global `~/.claude/hooks/lore-gate-g*` + project `hooks/g*` both fire on every matching call — duplicate latency, zero extra safety since GateEnforcer is the authoritative backstop); (3) `post-skill-tracker.mjs` wrote `wf-skills-invoked.jsonl` that NOTHING consumes (its REPORT-verification reader retired with docman 2026-07-13); (4) 8 dead `lib/` files (only self/comment references); (5) `subagent-context.mjs` directive keys were the RETIRED docman-era roster (`executor`/`reviewer`) — no live agent type matched, so per-type directives + lore project context silently never injected for `lore-implementer`/`lore-reviewer`/etc.; (6) `session-state/` grew unbounded (37MB / 1146 dirs, no reclaimer) and `stop-doc-sync` blocked even when the final message already carried `[DOC_SYNC]` (one wasted model round-trip per editing turn, observed 3× in one session). | **FIXED 2026-07-17 (owner: "先修复问题,然后 review")**: orphans + dead lib + tracker retired to `hooks/.retired-20260717/` (reversible), Skill matcher unmounted from settings; global gates gained a project-vendored dedupe guard (`CLAUDE_PROJECT_DIR/hooks/gN-*.sh` exists+executable → instant allow; foreign projects unchanged) in both copies, gate tests 26/26; `subagent-context` maps the live roster (implementer/tester→executor, explorer→Explore, planner→Plan, reviewer→reviewer; implementer/tester get lore pointers); `session-start` GCs session dirs idle >14d (37MB→11MB measured); `stop-doc-sync` reads `transcript_path` and passes silently when the last assistant message already contains `[DOC_SYNC]`. Hook tests 187/187, assets-ssot 51/51, 3 vendored hooks synced to `assets/hooks/`. Lesson: hooks need periodic consumer-audits — a writer whose reader was retired, and a roster map whose types were renamed, both fail SILENT. |
| 2026-07-16 | `design` skill (same root cause as row 1) — **systemic `mode-$0` pattern** | `design` SKILL.md:13 also `Read references/mode-$0.md`; invoked with a natural-language task string, `$0` grabbed the first token ("Produce") → `mode-Produce.md` 404. Valid modes: architecture/api/database/system/module (NOT the passed word). Bonus latent bug: the SKILL.md mode table lists `ui` but `references/mode-ui.md` does not exist either. **Root cause is shared across product+design skills**: both template `mode-$0.md` from the first arg token with no validation/fallback. | Course-corrected: chose **`module`** mode for the installer subsystem. When invoking these skills, pass the mode name as the FIRST token (e.g. `/design module <context>`), never a prose sentence. **FIXED 2026-07-16 (owner greenlight)**: design SKILL.md now validates `$0` against the known-mode set BEFORE any `Read` (unknown → AskUserQuestion); the phantom `ui` row was dropped from the mode table with a redirect to the dedicated `design-ui` skill (its `mode-ui.md` never existed). |

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

**Pre-push corpus gate**: `hooks/pre-push` runs `lore status --check-tree --check-drift` before every push (fail-open when `lore`/`.lore/` absent; bypass with `--no-verify`). After clone, activate with `git config core.hooksPath hooks`.

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
- `SPEC-039` — **implemented 2026-07-08, trust-hardened 2026-07-13 (§M2)** — trusted runner: attested evidence for script-mode ACs: `lore verify <plan> [--ac] [--task] [--allow-new-commands|--yes]` executes declared script-AC commands (Bun.spawn, detached process group, SIGTERM→5s→SIGKILL, per-AC `verify.script.timeout_ms` ?? `verify.default_timeout_ms` config), derives `result` from exit code (never caller-asserted), records evidence with `attestation {runner, exit_code, duration_ms, timed_out, first_seen?}` — OPTIONAL on `evidenceEntrySchema` (extractEvidence is whole-array fail-closed) and runner-issued only: public evidence write paths reject attestation-carrying input loud; `recordVerifiedEvidence` (TaskWorkflowService, not CLI/MCP-exposed) is the sole injection site. Target task: explicit `--task` > unique fresh-claim match (`resolveTargetTask` pure fn) > loud ambiguity error. MCP `lore_verify` (24 tools). `computeAcCoverage` carries `attested_pass/attested_fail`; `lore ac list` renders `⚑✔`; assess prompt annotates attested counts (`ASSESS_PROMPT_VERSION` 5). Launch failure (ENOENT) → err with NO evidence; nonzero exit/timeout → attested fail. **§M2 trust-hardening (review finding M2, `sync.enabled` multi-writer RCE-via-planted-`verify.command` threat)** — three DEFAULT-ON, independently config/flag-escapable layers, replacing the original bare "npm-scripts trust level, full env passthrough, no sandbox" posture (no sandbox claim is UNCHANGED — an approved command still runs with the invoker's shell privileges): (1) **env allowlist** — a spawned command receives ONLY `DEFAULT_VERIFY_ENV_ALLOWLIST` (`PATH,HOME,USER,LOGNAME,SHELL,LANG,LC_*(prefix),TZ,TMPDIR,TEMP,TMP,TERM,PWD`, `verify-spawn.ts`) plus any `verify.env.allowlist` (additive) — never the full `process.env` (secrets like `LORE_SYNC_TOKEN` are scrubbed by default); `verify.env.passthrough_all: true` restores full passthrough. (2) **command-provenance approval gate** — a script AC's command NOT byte-identical to any prior entry in the target task's evidence history (`isApprovedVerifyCommand`, `@lore/core`) requires explicit approval before executing: CLI interactive TTY (no `--json`) prompts y/N; `--allow-new-commands`/`--yes` (CLI) or `allow_new_commands: true` (MCP, which is NEVER interactive) approves without prompting; neither → `NEEDS_APPROVAL` (new `LoreError` code, CLI exit 7) aborts the run at that AC, naming the exact recovery flag. A command already in evidence history is NEVER re-prompted. `verify.require_command_approval: false` disables the gate entirely. (3) **command-provenance annotation** — an approved new/changed command's evidence carries `attestation.first_seen: true` (present-iff-true, computed independently of whether the gate is enabled); `lore verify` renders `[new]`, `--json`/MCP surface `results[].first_seen`. `passthrough_all: true` + `require_command_approval: false` together restore the exact pre-§M2 (2026-07-08) behavior.
- `SPEC-038` — **implemented 2026-07-08** — AC-as-code: structured acceptance criteria + oracle binding (PRD §14 input-quality hardening; ADR "AC-as-code"): `spec.extra.acceptance_criteria` (typed array, `verify` discriminated union script/ai/human; `acceptance.ts` in `@lore/core`), `ORACLE_KINDS` single-definition-site consolidation (3 copies → `task-workflow.ts`), evidence `ac_ref` (`lore evidence --ac`, MCP `lore_evidence_add.ac_ref`) with cross-entity validation via `resolveDeclaredAcIds` port (CorpusService-implemented, constructor-injected into TaskWorkflowService), `lore ac add/list/rm` (`AcService`), assess judge consumes the declared AC set (`ASSESS_PROMPT_VERSION` 3→4, out-of-set `ac_id` → hard error, no retry, no doc), structured-AC checklist in text projection (`lore get` non-raw + `export-docs`, `✔/✘/·` coverage prefixes from `computeAcCoverage`)
- `SPEC-042` — **implemented 2026-07-11** — session layer part 2: session registry + file-anchor claim safety (PRD §15 S3): derived (never-stored) session registry grouping FRESH claims by `(by, machine, worktree)` (`deriveSessions`, `@lore/core`), surfaced as `lore ready`'s plan-scoped `sessions[]`/`anchor_conflicts[]` and `lore bootstrap`'s corpus-wide `active_sessions`; typed `task.extra.file_anchors: string[]` (`normalizeFileAnchors`/`anchorsOverlap`, `packages/core/src/file-anchors.ts`) authored via `lore create task --anchor <path>` (repeatable) and `lore anchor add/rm/list <task>` (never `lore set --anchor` — deliberately not built, D3); `task-claim` gate gains the `noAnchorOverlap` predicate (`gate:task-claim:anchor-overlap` discriminator), evaluated UNCONDITIONALLY (not gated by upstream-spec presence) — a fresh claim whose declared anchors overlap another fresh, foreign sibling claim in the same plan is REJECTED at `lore claim`, feeding pack names the conflicting task/holder/paths plus a literal `lore release <slug> --by <holder> --force` recovery command; `lore claim --machine/--worktree` (machine auto-captured as `os.hostname()`, worktree ALWAYS explicit — never `process.cwd()` capture) with same-holder-fresh-refresh carry-forward (`buildTaskClaim`); `lore tree` claim badge gains `@branch`; MCP `lore_anchor_set` (28 tools total), `lore_claim`/`lore_create` gain `machine`/`worktree`/`file_anchors`. See "Concurrent Worktree Dispatch" below for the actor-identity discipline this predicate depends on.
- `SPEC-043` — **implemented 2026-07-11** — memory hygiene part 1: bi-temporal invalidation (PRD §16 H1): `extra.validity` on `knowledge`/`adr` docs (`{valid_at?, invalid_at?, invalidated_by?, reason?}`, `packages/core/src/validity.ts`) — pure `isInvalidated`/`effectiveValidAt` predicates, `ValidityService.invalidate` (the SOLE write path, CLI `lore invalidate <id> [--superseded-by <id>] [--reason] [--undo]`); `lore search`/`lore list` exclude invalidated knowledge/adr by default (`--include-invalid` escape, `[invalid]` badges), `lore get`/export-docs/`lore feed` ALWAYS mark them via a shared banner renderer (`> ⚠ INVALIDATED <date> — superseded by <slug>; <reason>`, never filtered), `lore tree` always shows `[invalid]` badges; `lore create <type> --supersedes <old>` composes create→invalidate in one command (loud half-failure: nonzero exit naming the exact `lore invalidate` repair command, never silent); `CorpusService.set` rejects any patch that would change `extra.validity` (naming `lore invalidate` as the correct path); MCP `lore_invalidate` (29 tools total) + `lore_get.validity_state` (computed `{invalidated, invalid_at?, invalidated_by_slug?, reason?}`) + `lore_create.supersedes`/`by` + `lore_search`/`lore_list.include_invalid`; `lore status` warns when a gate's discovered feeding-source skill doc is invalidated.
- `SPEC-044` — **implemented 2026-07-12** — memory hygiene part 2: staleness probes (PRD §16 H2): `packages/core/src/staleness.ts` — pure `selectProbeCandidates` (type/soft-delete/invalidated/`age_days ≥ min_age_days` filters, `computeStalenessPriority = in_degree × age_days`, deterministic sort+limit) + `stalenessVerdictSchema` (the raw judge output contract, `"holds" | "stale_candidate"`); migration-005 adds `review_judgments.kind` (`'review' | 'staleness'`, store-contract-enforced on `latestJudgment`/`findJudgments`/`latestJudgmentsByDocIds` — a staleness "holds" row can never masquerade as a real review approval in `lore pending`) + `superseded_candidate` (JSON, shared by D6/D11 below); `StoreInterface.countLinksByToIds`/`latestJudgmentsByDocIds` (SQLite/Turso/InMemory) back the priority scan with ONE batch call each, never a per-candidate N+1; `StalenessProbeService` (batch/single-doc orchestration, `packages/lore/src/service/staleness-probe-service.ts`) + `AIProviderService.probeStaleness` (`packages/lore/src/ai/staleness-template.ts`, `STALENESS_PROMPT_VERSION` v1, one corrective retry, hard-fail-no-retry on an out-of-enum decision). CLI `lore review --staleness [--limit] [--min-age-days] [--fail-on-candidate] [--list]` (batch, top-N by priority) + single-doc `lore review <doc> --staleness` (bypasses selection filters, refuses an already-invalidated target, exit 4) — deterministic pre-checks (SPEC-034) do NOT run for staleness, a separate pipeline; no non-AI mode (`--no-ai` exits 2) EXCEPT `--list` (a pure read, zero provider calls); partial-batch AI failures collect-and-continue (exit 6 only when EVERY probe failed); `--fail-on-candidate` exits 3 on ≥1 fresh `stale_candidate`. Escalation is REPORT-ONLY, never auto-invalidation — every `stale_candidate` result renders the literal `lore invalidate <slug> --reason "<first reason, ≤100 chars>"` repair command, appending `--superseded-by <ref>` ONLY when the judge's nomination resolves in the corpus (unresolvable → a plain-text note, never a broken command). D11 byproduct: a REGULAR (non-staleness) review judgment MAY also carry `superseded_candidate` (schema-shared, opposite direction — "this doc supersedes an older one"), rendering the `lore invalidate <old> --superseded-by <X>` nudge on ordinary `lore review` output (absent field → byte-identical, REGRESSION-protected). `flows/staleness-flow.ts` is the single derivation site both `--list` and `lore status`/`lore bootstrap`'s `open_stale_candidates` count consume (SPEC-043's `computeArmedGates` precedent) and the single JSON-payload-construction site CLI `--json` and MCP both call verbatim. MCP `lore_staleness_probe {limit?, min_age_days?, id_or_slug?, list?, by}` (`by` required — the audit-row actor; 30 tools total). `ValidityService` gains an OPTIONAL constructor port (`stalenessCalibration`, same optional-DI shape as `GateEnforcer`) — a human `lore invalidate` on a doc whose latest staleness judgment is a `stale_candidate` escalate writes ONE calibration record FK'd to that judgment; `computeCalibrationStats`'s group key gained judgment `kind` so staleness and review calibrations never pool under the same prompt-version literal. Config: `ai.staleness.*` (`max_doc_chars` 12000, `neighbor_limit` 20) + `workflow.staleness.*` (`default_limit` 5, `min_age_days` 14, inclusive boundary).
- `SPEC-045` — **implemented 2026-07-12** — memory hygiene part 3: doc-code drift oracle (PRD §16 H3): specs may declare code anchors — repo-relative file paths, directory scopes, or `path[#Symbol]` bindings — in `spec.extra.code_anchors` (`packages/core/src/code-anchors.ts` — pure `parseCodeAnchor`/`normalizeCodeAnchorEntries`/`scanExportedSymbols`/`computeDrift`, six drift kinds: `file_missing | dir_missing | dir_empty | symbol_missing | node_type_mismatch | probe_error`). `DriftCheckService` (`packages/lore/src/service/drift-check-service.ts`) orchestrates via an injected `FsProbe` port (every probe call individually try/catch-wrapped — a throw becomes a `probe_error` row, never a batch-abort, G11's zero-false-negative guarantee) and owns the spec-target anchor RMW verbs (`addCodeAnchors`/`removeCodeAnchors` incremental, `setCodeAnchors` declarative REPLACE). `lore status --check-drift` — deterministic, zero LLM calls, CI-runnable (exit 3 on drift) — COMPOSES with `--check-tree` (T2 restructured `status.ts` off early `process.exit` onto value-returning checks; exit precedence: any drift found (either check) → 3, else blueprint missing/invalid → 4, else 0; both requested reports always print/emit fully). Drift rows render `spec-slug → anchor (kind)` + a literal `fix: lore anchor rm <spec-slug> '<anchor>' (or update the path/export)` repair hint, deterministically sorted (spec_slug, then anchor); `--json` emits `data.code_drift = {armed, enabled, consistent, specs_checked, status_breakdown, drifts[]}`. Plain `lore status`/`lore bootstrap` print a store-only `code anchors declared: N specs` line/`code_anchor_specs` count — ZERO filesystem probing (`flows/drift-flow.ts::countArmedSpecs`, the shared helper both use). `lore anchor add/rm/list <target>` resolves the target FIRST then dispatches by type — task → `TaskWorkflowService` (byte-identical, REGRESSION; a `#`-carrying task anchor is rejected loud, naming the spec grammar) — spec → `DriftCheckService` — any other type → `VALIDATION_ERROR` naming "task or spec". `lore create spec --code-anchor <path[#Symbol]>` (repeatable) is a DISTINCT flag from task's `--anchor`. `flows/drift-flow.ts` is the single `code_drift` payload builder BOTH CLI `--json` and MCP `lore_status {check_drift: true}` consume — `lore_status` migrated off its argless 3-arg MCP registration onto `registerToolWithArgs` (`check_drift?: boolean`, its first input schema; an argless call stays byte-identical, REGRESSION); `lore_anchor_set` gains spec-target dispatch with DECLARATIVE REPLACE semantics (`DriftCheckService.setCodeAnchors`) — diverges from the CLI's incremental `add`/`rm`, documented in the tool description; tool count stays 30 (no new tool). `renderResolvedToMarkdown` (`OutlineService`, the SPEC-032 text-projection seam) splices a `## Code anchors` list for a spec with declared anchors — zero fs probing, byte-identical when absent (REGRESSION). Config: `workflow.drift.enabled` (default `true`) — `false` makes `--check-drift` exit 0 with an explicit `disabled` note (LOUD skip). Real `FsProbe` (`packages/lore/src/adapters/real-fs-probe.ts`, node:fs sync, repo root `process.cwd()`) is shared by the CLI and MCP adapters — `stat()` never throws (collapses every failure to `"missing"`, the safe G11 direction).

- `SPEC-046` — **implemented 2026-07-16** — Distribution part 1 (PRD §17 P0+P1): repo-root `assets/` SSOT tree (vendored lore-* skills/agents/hooks + project gate hooks + `assets/governance/corpus-workflow.md`, the standalone team-generic governance snippet — conformance oracle `packages/lore/tests/unit/assets-ssot.test.ts`) + `lore setup` local safe installer — 31st CLI command (`--dry-run` / `--uninstall` / `--project` / `--claude-dir` / `--yes` / `--json`, bypasses `loadLoreApp` like init/sync): `SetupService` (four injected ports: `AssetSource`, split `SetupFsReader`/`SetupFsWriter`, `McpRegistrar` shelling `claude mcp add/remove -s user`) writes every touched path into the authoritative `<claude-dir>/.lore-setup-manifest.json` (manifest-last ordering; uninstall reverses STRICTLY via it, restore-from-backup byte-identical), invariants I1–I5 incl. malformed-settings.json → zero-write fail-loud and manifest sha256 = final on-disk bytes; `ProjectSetupService` + `flows/setup-project-flow.ts` (repo scaffold: corpus init via `flows/init-corpus.ts` thunk + conflict-checked hooks + tree blueprint + `core.hooksPath`); real ports in `adapters/real-{asset-source,setup-fs,mcp-registrar}.ts` (atomic tmp+rename writes; `node:child_process` NOT `Bun.spawn` — the Bun global is absent in vitest worker threads); `assertSafeTargetDir` blocks tests from the real `~/.claude` (`LORE_SETUP_ALLOW_REAL=1` = the adapter's production escape). OUT (later specs): P2 npm publish, P3 cross-compile + binary-embedded assets (spike-gated), win32. Compiled-mode detection: `Bun.main.startsWith("/$bunfs/")` — `Bun.isStandaloneExecutable` does not exist in Bun 1.3.10 (`setup-args.ts`)

- `SPEC-047` — **implemented 2026-07-16** — session seat auto-briefing (PRD §15 S3 extension): a session opened inside a LINKED git worktree of a lore-governed repo gets its parallel-seat discipline AUTO-INJECTED by the SessionStart hook — zero paste. `assets/governance/seat-briefing.md` (SSOT template, `{{ACTOR}}`/`{{BRANCH}}`/`{{MAIN_CHECKOUT}}` tokens) + `session-start-resume.mjs` Phase D: linked-worktree detection via resolved `git rev-parse --git-common-dir` ≠ `--git-dir`, actor = `agent:<branch sanitized to [a-z0-9-]>` (detached HEAD → `worktree-<shortsha>`), briefing lookup `<claude-dir>/governance/` → `<main-checkout>/assets/governance/` → fail-open skip; `lore bootstrap` spawn cwd redirected to the main checkout (worktrees carry no `.lore/`). Main-checkout sessions byte-unchanged (REGRESSION-tested). Byproduct fix: SPEC-046 vendoring had missed `assets/hooks/lib/turn-state.mjs` — the vendored hook was un-runnable (`ERR_MODULE_NOT_FOUND`) until SPEC-047's behavior test forced the gap; now vendored + both assets-manifest tests track it. OUT: a `lore seat` worktree-creation verb (later sugar)

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

### Bi-temporal Invalidation (SPEC-043)

Only `knowledge`/`adr` docs carry `extra.validity` — a nested, optional field (zero-migration: a doc with none is simply currently valid, `valid_at` defaulting to `created_at`). `ValidityService.invalidate(idOrSlug, {supersededBy?, reason?, by, undo?})` is the SOLE writer; `CorpusService.set` (and thus `lore_set`/dashboard PATCH) rejects any patch that would CHANGE `extra.validity`, naming `lore invalidate` in the error. Invalidation is orthogonal to workflow `status` (D5) — an `approved` doc can be invalidated; invalidating never touches `status`.

Read-surface split (D3):
- **Filtered by default** (list/search-shaped reads): `lore search`, `lore list`, the `RecentDecisions`/`RelatedOf` MDX placeholders. `--include-invalid` (CLI) / `include_invalid: true` (MCP `lore_search`/`lore_list`) / `includeInvalid` (MDX prop) restores them, always badged `[invalid]`.
- **Never filtered, ALWAYS marked** (direct-address/composed reads): `lore get` (non-raw — invalidation banner prepended via the shared `renderDocMarkdown`, `flows/feed-flow.ts`), `export-docs` (banner folded into the written body, `ExportDocsService`), `lore feed` (feeding-skill pack), `lore tree` (`[invalid]` badge on every row, unconditionally), MCP `lore_get.validity_state` (computed `{invalidated, invalid_at?, invalidated_by_slug?, reason?}` — agents parse JSON, not markdown), the HTTP doc route (same `validity_state` field), the review-judge prompt (`# Staleness Notice` section), `Embed` (degrades to a skip-note unless `includeInvalid`).

`lore create <type> --supersedes <old> [--by <name>]` (CLI) / MCP `lore_create.supersedes`/`by` composes `CorpusService.create` THEN `ValidityService.invalidate(old, {supersededBy: new})` via the shared `flows/supersede-flow.ts::createWithSupersedes` — half-failure (create ok, invalidate fails) is LOUD: nonzero exit / `supersede_error` field, printing the exact repair command `lore invalidate <old> --superseded-by <new-slug>`. `--undo` clears `invalid_at`/`invalidated_by`/`reason` but never reverts an ADR's `decision_status: "superseded"` — surfaced structurally as `decision_status_unchanged: "superseded"` on both CLI `--json` and the MCP payload. `lore status` warns (text + `--json`'s `invalidated_feeding_source_warnings[]`) when a gate's discovered feeding-source skill doc is itself invalidated, computed via the same `computeArmedGates` helper `lore bootstrap` uses (never a second derivation).

### Staleness Probes (SPEC-044)

`lore review --staleness` judges whether a high-value `knowledge`/`adr` doc still holds true, ON DEMAND — no daemon, no scheduled scan (spend is bounded by explicit `--limit` × invocation). Priority = link in-degree × age-since-last-confirmation (`computeStalenessPriority`, `packages/core/src/staleness.ts`); `age_days` resets on either an edit OR a passing ("holds") probe (`lastConfirmedAt = max(updated_at, latest_holds_probe_at)`). A probe is REPORT-ONLY — it NEVER mutates the probed doc (no version bump, no `extra` change) and NEVER calls `ValidityService.invalidate` itself; the escalation surfaces a literal repair command for a human/agent to run.

Batch: `lore review --staleness [--limit N] [--min-age-days D] [--fail-on-candidate] [--json]` — top-N candidates by priority, via `StalenessProbeService.probeBatch`. Single-doc: `lore review <doc> --staleness` bypasses selection filters but still refuses an already-invalidated target (`VALIDATION_ERROR`, exit 4). Read-only listing: `lore review --staleness --list` — fresh (`doc_version`-matching) `stale_candidate` escalates only, ZERO provider calls, deliberately NOT folded into `lore pending` (disjoint populations: draft-awaiting-first-review vs. approved/active staleness candidates). `--fail-on-candidate` exits 3 when ≥1 fresh escalate — the CI-gate analog of `status --check-tree`. A batch's per-candidate AI failures collect-and-continue (exit 6 only when EVERY probe in the batch failed); `--json`'s `skipped: {invalidated, too_young}` + `total_candidates` + `excluded_by_limit` make every exclusion class countable, never a silent cap.

`flows/staleness-flow.ts` is the SINGLE derivation site for "which docs have an open stale-candidate flag" (`listFreshStalenessEscalates` — consumed by `--list`, `lore status`'s `open_stale_candidates` count, and `lore bootstrap`'s corpus summary count) AND the single `--json`/MCP payload-construction site (`buildStalenessBatchJsonPayload`/`buildStalenessSingleJsonPayload`/`buildStalenessListJsonPayload` — CLI and MCP `lore_staleness_probe` call the SAME functions, so the two surfaces' payloads are identical by construction, not by convention). It takes a NARROW injected dependency bundle (`StalenessFlowDeps`), never the full `App`, mirroring `flows/calibration-hook.ts`'s precedent — keeps it vitest-testable with plain fakes.

The repair-command renderer has TWO distinct directions sharing one `{ref, reason}` schema shape (`supersededCandidateSchema`, `packages/core/src/review-judgment.ts`) — never confuse them: a staleness probe's `superseded_candidate.ref` names the doc the judge believes SUPERSEDES the probed (stale) doc, so `renderStalenessRepairCommand` always names the PROBED doc as the `lore invalidate` target (`--reason` from the judgment's first reason, clipped to 100 chars) and appends `--superseded-by <ref>` only when `ref` resolves — the base command is ALWAYS valid since the probed doc's own slug is never in question. A REGULAR (non-staleness) review judgment's `superseded_candidate.ref` (the D11 byproduct) means the OPPOSITE — the doc the judge believes is superseded BY the one under review — so `renderSupersededCandidateNudge` names `ref` (not the reviewed doc) as the target; an unresolvable `ref` here degrades the WHOLE nudge to a plain note (there is no valid base command to fall back to, unlike D6). Rendering for the regular-review path lives in `packages/lore/src/adapters/cli/review-render.ts` (split out of `commands/review.ts` for vitest-testability, mirroring `assess-render.ts`) — `formatJudgmentSummary` is byte-identical pre-SPEC-044 output; `renderSupersededCandidateNudgeBlock` returns `""` when `superseded_candidate` is absent, making the concatenation a REGRESSION-safe no-op.

`ValidityService`'s constructor takes an OPTIONAL `stalenessCalibration` port (`{latestStalenessJudgment, recordCalibration}`, same optional-DI shape as `GateEnforcer`) — wired in `app.ts` to `JudgmentService`. When wired and `invalidate` lands on a doc whose latest staleness judgment is a fresh `stale_candidate` escalate, exactly ONE calibration record is written FK'd to that judgment; `JudgmentService.computeCalibrationStats`'s group key is `(doc_type, judge_prompt_version, kind)` so staleness and review calibration outcomes never pool into one Wilson bound even under the literal same `"v1"` prompt-version string.

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
