# Module: core

## Purpose

Foundational types, error model, runtime validation, lifecycle rules, config, and telemetry. Pure modules with no I/O except `config.ts` (file read/write) and `telemetry.ts` (append-only JSONL). Published as `@lore/core` workspace package; depends on no other `@lore/*` package.

## Key Invariants

- **Browser safety (`index.ts` barrel MUST stay import-safe from a browser bundle)** — `@lore/dashboard` imports only `@lore/core` (never `@lore/core/node`). Vite's dev-mode `fs` stub throws on named-export access **at module-load time**, not call time — so a single top-level `import { x } from "fs"` anywhere in the barrel's transitive closure blanks the SPA before React mounts, even if the importing code path never runs in-browser. Node-builtin-dependent code (`fs`/`path`/`os`/`child_process`) is split into `config-node.ts` (loadConfig/saveConfig/resolveGlobalConfigPath/loadGlobalConfig) and `telemetry-node.ts` (JsonlTelemetry/createTelemetry), both re-exported only via the `@lore/core/node` subpath (`node.ts`, `package.json#exports["./node"]`). `config.ts` and `telemetry.ts` keep the pure Zod schemas/types/interfaces/`NoOpTelemetry` and MUST NOT re-import fs/path/os. **Regression oracle**: `packages/dashboard/tests/e2e/write-flow.pw.ts` (SPEC-022, Playwright) — a `pageerror` in that suite before scenario 1 completes is this exact class of bug recurring. Grep check: `grep -rn 'from "fs"\|from "path"\|from "os"' packages/core/src/index.ts packages/core/src/config.ts packages/core/src/telemetry.ts` → 0 hits.
- **`DOC_TYPE_ROLE_MAP`** in `types.ts` is the SSOT for `DocType → DocRole`. Never derive role another way.
- **`ORACLE_KINDS` (`task-workflow.ts`) is the single oracle-enum definition site (SPEC-038 D3)** — `evidenceEntrySchema.oracle`, CLI `--oracle` choices, and MCP `EVIDENCE_ORACLE_ENUM` all reference it; never redeclare the literal list. `acceptance.ts::SCRIPT_ORACLES` is a deliberate explicit-literal subset (all kinds except `manual`) pinned by a type-level exhaustiveness assertion — adding a new `OracleKind` fails compilation there until someone decides whether it is script-verifiable.
- **`acceptance.ts` is the AC-as-code SSOT (SPEC-038)** — `acceptanceCriterionSchema` (id regex `^AC-[A-Z0-9]+(-[A-Z0-9]+)*$`, `verify` discriminated union script/ai/human), `specAcceptanceCriteriaSchema` (max 50, unique ids via superRefine), and `computeAcCoverage(criteria, tasks)` — a pure facts-only aggregator over task evidence `ac_ref`s (`{ac_id, mode, pass, fail, refs}`); rendering belongs to each consumer (CLI badge, outline projection, assess prompt), never here. Browser-safe, no wall-clock reads. `evidenceEntrySchema.ac_ref` is optional and format-unconstrained at this layer — cross-entity validation (declared-id membership) lives in `TaskWorkflowService.addEvidence` via an injected `resolveDeclaredAcIds` port implemented by `CorpusService`.
- **Result over throws** — `errors.ts` defines the `Result<T, LoreError>` discriminated union and `ok()` / `err()` constructors. Modules that import `LoreError` use these helpers, not raw object literals.
- **Slug shape** — `^[a-z][a-z0-9-]{1,62}[a-z0-9]$` (3–64 chars, no leading/trailing hyphen). Generation lives in `schemas.ts::slugify`; collision resolution (-2, -3, …) is delegated to the caller via `slugifyWithCollision`'s `existsSlug` callback (sync or async).
- **Lifecycle graph** — `VALID_TRANSITIONS` in `schemas.ts` is the only authority on status moves. `isValidTransition(from, to)` and `getAllowedTransitions(from)` are the only public reads.
- **Config: env-var NAME, never plaintext (D-004)** — `sync.auth_token_env` stores the variable name (`"LORE_SYNC_TOKEN"` by default). `resolveSyncCredentials()` reads `process.env` at call time and fails loud (`VALIDATION_ERROR`) when missing or empty.
- **Telemetry never throws** — `JsonlTelemetry.record()` swallows IO errors; `close()` is idempotent; post-close `record()` is a no-op. Caller-visible behaviour does not change between `NoOpTelemetry` and `JsonlTelemetry`.

## Patterns

- **Zod is SSOT for runtime-validated shapes** — `TelemetryEventSchema`, `LoreConfigSchema`, `createDocInputSchema`, etc. Derived TS types come from `z.infer<typeof Schema>`; never duplicate the shape as a hand-written interface.
- **Type-specific validation via `superRefine`** — `createDocInputSchema` enforces `spec/task → parent_id`, `adr → extra.decision_status`, `knowledge → extra.sub_type`, `task → extra.plan_id`, `plan → extra.phases uniqueness` (`schemas.ts`).

### AI Plan-Outcome Assessment Schema (SPEC-026)

`assessment.ts` is a pure, browser-safe module (no IO, no `Date.now()`/`Math.random()`):
- `llmAssessmentOutputSchema` — the shape the AI judge's raw JSON response must match (`verdict`/`overall_score`/`ac_scores`/`gaps`/`recommendations`). Deliberately excludes `scope` and `judgment` — the model cannot know its own provider name, prompt version, or wall-clock duration; `AIProviderService.assessPlan` computes and layers those on after a successful parse.
- `assessmentResultSchema` = `llmAssessmentOutputSchema.extend({scope, judgment})` — the full persisted shape. This is what `knowledgeExtraSchema`'s `extra.assessment` branch validates against.
- `planBundleSchema` / `PlanBundle` — `{plan, spec?, tasks[]}`, assembled by `CorpusService.getPlanBundle`. Uses `z.custom<DocRecord>()` per slot (a light structural + `type` check, not a full `DocRecord` re-validation — `DocRecord` has no Zod schema anywhere else in this codebase; it's produced by the trusted store layer).
- `extractAssessmentJson(raw)` — tolerant JSON extraction from raw AI text: bare JSON → ` ```json ` fence → generic ` ``` ` fence → prose-wrapped (first `{` to last `}`). Never throws; returns a `VALIDATION_ERROR` Result when no JSON is found. Does NOT validate shape (that's `llmAssessmentOutputSchema`'s job) — a bare JSON array parses successfully here and fails schema validation downstream.
- `truncateSection(text, maxChars)` — single-section truncation primitive consumed by the prompt builder (`packages/lore/src/ai/assess-template.ts`) against `ai.assess.*` config budgets; truncated section names are collected into `judgment.truncated[]`.
- `renderAssessmentContent(result)` — deterministic Markdown rendering of a persisted `AssessmentResult` for the knowledge doc's `content` field. `extra.assessment` is the SSOT; `content` is generated ONLY by this function at creation time.

`knowledgeExtraSchema.sub_type` enum includes `"assessment"` — its `superRefine` requires a Zod-valid `extra.assessment` whenever `sub_type === "assessment"`. Manually creating a knowledge doc with `sub_type: "assessment"` (e.g. via `lore create` or the dashboard) without a matching `extra.assessment` payload fails loud — only `lore assess` / `lore_assess` write this sub_type.

`AiConfigSchema.assess` (`ai.ts`) holds the four character budgets (`max_plan_chars: 8000`, `max_spec_chars: 12000`, `max_task_chars: 4000`, `max_diff_chars: 24000`), mirroring the `ai.refine.max_input_chars` precedent.

### Plan Phases Schema Invariants (SPEC-023)

`planExtraSchema` (in `schemas.ts`) governs plan extra fields:
- `phases?: Array<{name: string, description?: string}>` — max 30 entries (hard cap via `.max(30)`).
- `phases[].name` **must be unique** within the array — enforced by `superRefine` at write time (no built-in Zod uniqueness validator).
- Names are **case-sensitive, exact-match** at validation time; callers must trim whitespace before passing (service layer handles this).
- `phase?: string` — legacy singular field, deprecated. `lore migrate phases` converts it to `legacy_phase`. Do NOT write new code that reads `extra.phase` on plans (may be legacy or undefined). Read `extra.phases[]` instead.
- `legacy_phase?: string` — set by migration only. Informational. Not consumed by runtime code.

`taskExtraSchema` adds `phase?: string` — validated against parent plan's `extra.phases[].name` by `CorpusService` (not Zod, since it's cross-entity). Tasks without `extra.phase` are always valid regardless of plan phase declarations.
- **Parent-type contract** — `doc-type-rules.ts::PARENT_TYPE_CONTRACT` and `isValidParentType(child, parent)` are imported by `CorpusService` and `TreeCheckService`. Adding a new doc type requires updating this contract.
- **Graph helpers stay pure** — `graph-utils.ts::ancestorChainWalk` and `tree-blueprint.ts` operate on plain data; they don't take a `StoreInterface`. Callers fetch the data and pass it in.
- **Config side effects isolated to `loadConfig` / `saveConfig`** (now in `config-node.ts`, `@lore/core/node` subpath) — `parseConfig` and `loadConfigFromString` (in `config.ts`, default barrel) are pure and Result-returning; tests pass YAML strings, not file paths.
- **`doc-type-meta.ts::deriveTypeMeta(doc, opts?)` is the single derivation point for `DocSummary.meta`** (SPEC-036 §2 D3, browser-safe, no Node imports) — a discriminated union (`DocTypeMeta` in `types.ts`) keyed by `doc.type` (spec `kind` / adr `decision_status` / knowledge `sub_type` / plan `phase_count` / task `claimed_by?+claim_stale?+evidence_pass+evidence_fail`; `prd` → `undefined`). Never throws on arbitrary/legacy `extra` (null, wrong types, missing fields) — degrades by OMISSION, with exactly one documented default (absent `spec_kind` → `"feature"`, mirroring `CorpusService._createImpl`'s create-time default); reads `Date.now()` ONLY for `task.claim_stale`, and only when `opts.claimTtlMinutes` is supplied (a narrow, explicitly-noted deviation from this package's "no wall-clock reads" convention, forced by SPEC-036's fixed no-`nowIso` signature). Reuses `task-workflow.ts`'s exported `extractEvidence`/`extractClaim` (both now guard non-object `extra` via a local `safeTaskExtra` helper) rather than re-deriving evidence/claim parsing.

## Links

- Depends on: **(no other `@lore/*` packages)** — leaf of the dependency graph.
- Used by: `@lore/lore` (all of `packages/lore/src/`): service/, store/, adapters/cli/, adapters/mcp/, adapters/http/, eval/, and app.ts — imports both `@lore/core` and `@lore/core/node`.
  `@lore/dashboard` — imports `@lore/core` ONLY (never `@lore/core/node`; see Browser safety invariant above).
