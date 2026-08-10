---
id: SPEC-26
type: spec
role: spec
title: "lore assess — AI plan-outcome assessment (LLM-as-judge feedback loop)"
status: approved
priority: high
created: 2026-07-02
updated: 2026-08-01
tags: [ai, assessment, judge, feedback-loop, workflow]
parent: PRD-001
---
# SPEC-026: `lore assess` — AI plan-outcome assessment

> **Status: design ratified 2026-07-02** after a 4-perspective module review (coupling / cohesion / reuse-extension / testability); the coupling↔cohesion service-placement conflict is resolved in §6. Upstream driver: the SPEC-025 feedback-loop gap — mechanical oracles (tests/typecheck) answer "does it pass?", nothing answers "does the implementation match the original intent, and how well?".

## 1. Purpose

SPEC-025 gave tasks verifiable oracle evidence. What remains unanswered from the corpus alone:

- Did the implementation **semantically satisfy** the spec's acceptance criteria, or merely make tests pass?
- How **well** was it done — gaps, shortcuts, quality concerns a mechanical oracle cannot see?
- Where should the **next iteration** focus?

`lore assess <plan>` sends the plan, its spec's ACs, every task's evidence trail, and (optionally) the code diff to the configured AI provider, and persists a **structured, auditable judgment** back into the corpus, linked to the plan — closing the plan → execute → assess → improve loop.

## 2. Goals & Non-Goals

### 2.1 Goals

- New CLI command `lore assess <plan> [--diff <git-range> | --diff-file <path>] [--json] [--ai|--no-ai]`.
- New MCP tool `lore_assess` (agents are first-class consumers of the loop).
- **Derived diff by default (shipped 2026-08-01)** — when neither `--diff`, `--diff-file` nor (MCP) `diff_text` is supplied, `lore assess` assembles the diff from the plan's OWN commit set rather than asking the caller for a git range. A plan's commits are not contiguous in `main` under concurrent sessions, so no caller-supplied range can be correct; the two flags remain as explicit overrides. Mechanism (`assess-commit-derivation.ts`, shared by the CLI and MCP adapters): match each task's slug with `git log --fixed-strings --grep=<slug>` (exact-token, no regex ambiguity), union across the plan's tasks, prune to maximal elements under the ancestor order, then diff each surviving commit against its own FIRST parent (`git diff <sha>^1 <sha>`). Interleaved history is therefore immune to whatever merged before or after, and — unlike the branch-based approach originally rejected in §2.2 — a deleted branch is irrelevant because branches are never consulted.
- **Diff provenance is recorded, and an empty derivation is loud** — every run persists `extra.diff_source` (additive `.passthrough()` key on the assessment doc) and surfaces it in `--json`/MCP envelopes, so an auditor can distinguish a derived diff from a supplied one and a complete one from a partial one; `diff_available=true` alone is insufficient. Zero matches across every task is a NAMED status, never a silent empty diff reported as audited.
- Assessment persisted as `knowledge` doc, `sub_type: "assessment"`, `parent` = assessed plan, plus an `informs` link assessment → plan. `extra.assessment` is the Zod-typed SSOT; `content` is a human-readable rendering of the same data.
- Judge metadata (`provider`, `prompt_version`, `duration_ms`, `retried`, `truncated[]`) persisted inside the result — every judgment is auditable.
- Reuses the existing `AIProvider` abstraction (SPEC-017 CLI provider / SPEC-020 HTTP provider) unchanged.

### 2.2 Non-Goals

- ❌ **Auto-trigger on plan archive** — explicit command only (user default, ratified; archive-time hint may come later).
- ❌ **Task-level standalone assessments** — plan-level v1; the result schema carries a `scope` discriminator so task scope is additive later (D6), but no task-level command ships now.
- ❌ **Multi-judge ensemble / score aggregation** — single judgment v1; schema nests `judgment` so `judgments[]` is additive later.
- ~~❌ **Auto-deriving the diff range from evidence branches** — branches get deleted after merge; explicit `--diff` v1, derivation is v2.~~ **SUPERSEDED 2026-08-01** — derivation shipped and is now a Goal (§2.1). The original rationale was branch-lifetime; the shipped mechanism never tracks branches, so the objection no longer applies.
- ❌ **Assessment diffing UI** — re-assessments are separate append-only docs; `lore diff` on versions and doc-to-doc comparison already exist.
- ❌ **Gating semantics** — an assessment never blocks lifecycle transitions; it informs humans/agents, it does not enforce.

## 3. Design Decisions (ratified; alternatives weighed)

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| D1 | **Placement**: `CorpusService.getPlanBundle(planIdOrSlug)` (new read helper) + `AIProviderService.assessPlan(bundle, opts)` (fifth method) + adapter persists via `corpusService.create/link` | (b) new `AssessmentService` injecting AIProviderService — cross-service call, forbidden by service rules; (c) new service injecting raw `AIProvider` + store — duplicates doc-creation competence or bypasses CorpusService SSOT; (d) bundle assembly in the CLI — tree-walk/multi-fetch business logic in an adapter, violates adapter contract | Resolves the coupling↔cohesion reviewer conflict (§6): AIProviderService keeps its store-free dependency footprint and its uniform method shape (render → invoke → validate → telemetry, like `inferLinkType`); multi-doc fetch lands in CorpusService where read orchestration already lives (`tree`); adapter stays a 4-call thin pipe, same shape as SPEC-019's `link --infer`. |
| D2 | **Structured output**: `extractAssessmentJson(raw)` pure function in core (tolerates markdown fences / prose-wrapped JSON) → Zod safeParse → ONE corrective retry (parse error fed back into a follow-up prompt) → second failure = `AI_PROVIDER_ERROR` carrying a raw-output prefix; retry orchestrated by a **sibling** private helper, `_invokeProvider` untouched | (b) no retry — LLM format jitter is common, one corrective round-trip is standard judge practice; (c) lenient regex field-scraping — silent degradation, forbidden; (d) retry loop >1 — masks systematic prompt/provider failure | Fail-loud with bounded self-correction. Pure extraction function is unit-testable across fence variants without any provider machinery (testability review). |
| D3 | **Inputs**: `PlanBundle { plan, spec?, tasks[] (each with SPEC-025 verification_evidence) }` + optional diff text. Diff acquisition stays in the CLI: `--diff <range>` shells `git diff <range>`; `--diff-file <path>` reads a file (mutually exclusive); with neither supplied, `assess-commit-derivation.ts` (adapter-level, shared by CLI and MCP per the `task-feed-wiring.ts`/`phase-wiring.ts` cross-adapter precedent) derives the plan's own commit set and assembles the diff — see §2.1. Provenance lands in `extra.diff_source` | Diff in service (env-dependent IO in a service); a `DiffSource` DI interface (ceremony — the `--diff-file` flag IS the hermetic test seam, mirroring the existing `--content-file`/`--output-tail-file` CLI idiom); deriving in the service (same env-dependence objection, and both adapters would need it) | Service stays pure; tests get a seam for free; one real-git fixture integration test covers the subprocess path; derivation sits beside the other git-shelling code rather than splitting diff acquisition across two layers. |
| D4 | **Persistence**: `knowledge` + `sub_type: "assessment"`, parent = plan, `informs` link assessment → plan; `extra.assessment` typed via an explicit `knowledgeExtraSchema` branch; multiple assessments = append-only separate docs | (b) `plan.extra.assessment` — bloats the plan, history only via version archaeology; (c) new doc type — 7+ consumer sites for sub_type already (coupling review), a full type touches far more (type system, contract table, exports, dashboard) | Reuses the whole toolchain (links, export-docs, versioning, MCP) for free; append-only preserves the judgment audit trail. |
| D5 | **Surface default**: `assess` works without `--ai` on every surface — the command name IS the AI intent (SPEC-024 guards *implicit* AI, e.g. `lore create` silently generating); `ai.default_per_surface.<surface>=false` acts as a config brake: assess then errors with guidance and requires explicit `--ai` | Requiring `--ai` on agent surfaces (SPEC-019 convention for `set --regenerate`) — that convention exists because `set` has a non-AI mode; assess has none, double opt-in is noise | Explicit command + config-level brake serves both philosophies. `--no-ai` exits 2 (contradiction). |
| D6 | **Result schema** (see §8.2): 3-state `verdict`, `overall_score` 0-100, per-AC `ac_scores`, typed `evidence_refs: {doc_id, note?}[]`, `gaps[]`, `recommendations[]`, **nested `judgment`** object, **`scope: {type: "plan"\|"task", id}`** discriminator (always `"plan"` in v1) | Flat judge fields (blocks ensemble extension); 5-state verdict (redundant — ac_scores carry granularity); free-string evidence refs | Extension review: nesting + scope cost ~nothing now, prevent breaking reshape later. |
| D7 | **Char budgets in config**: `ai.assess.{max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000}` in `AiConfigSchema`, mirroring the existing `ai.refine.max_input_chars` precedent; truncation applied in core helpers, recorded in `judgment.truncated[]` | Bare constants in core — breaks the established config SSOT precedent | Consistency; visible truncation means the reader always knows what the judge did NOT see. |
| D8 | **Prompt home**: the judge prompt template + `ASSESS_PROMPT_VERSION` const live in `packages/lore/src/ai/` (templates.ts or a sibling `assess-template.ts`), NOT in core | Prompt strings in `core/assessment.ts` — creates a second prompt home; `ai/CLAUDE.md` declares templates.ts the prompt SSOT (cohesion review) | Core keeps only schemas + pure data helpers (task-workflow.ts precedent); prompt_version is owned and bumped where the template text lives. |
| D9 | **Test double upgrade**: `InMemoryAIProvider` gains a **sequence mode** (FIFO of scripted responses, one consumed per `generate()` call) | Keeping single fixed mode — the corrective-retry path (malformed → valid) would be untestable (testability review: current `setMode` is single-valued) | Retry AC gets a deterministic unit-test oracle. |
| D10 | Telemetry: one event per assess run through the existing `_emitAiEvent` pipeline with an operation discriminator, success and failure both recorded | New bespoke event plumbing | Matches how the other four AI operations report. |

**User-default provenance**: plan-level scope, git-diff input, manual trigger, knowledge-subtype persistence were chosen as recommended defaults after AskUserQuestion timed out (user away); each is cheap to revisit.

## 4. Acceptance Criteria

**AC-ASSESS-1** `lore assess <plan>` (provider configured) creates a `knowledge` doc: `sub_type="assessment"`, `parent_id` = plan, `informs` link to the plan, Zod-valid `extra.assessment`, human-readable `content` rendering, exit 0. `--json` emits the full result envelope.

**AC-ASSESS-2** The prompt contains: plan content, linked spec's AC section (when the plan's parent is a spec), every child task's title/content/verification_evidence; `ac_scores[]` in the result reference AC identifiers found in the spec.

**AC-ASSESS-3** First provider response malformed, second valid (sequence mode) → success with `judgment.retried = true`.

**AC-ASSESS-4** Both responses malformed → `AI_PROVIDER_ERROR` including a raw-output prefix (≤500 chars); **no document is created**.

**AC-ASSESS-5** No provider configured/available → fail loud `AI_PROVIDER_ERROR` with configuration guidance (no silent skip).

**AC-ASSESS-6** `--diff <range>` injects `git diff <range>` output into the bundle; `--diff-file <path>` reads the file instead; passing both exits 2.

**AC-ASSESS-7** Any section exceeding its `ai.assess.*` budget is truncated and its name appears in `judgment.truncated[]`. (BOUNDARY)

**AC-ASSESS-8** Assessing a plan with zero child tasks → `VALIDATION_ERROR` ("nothing to assess"). (NEGATIVE)

**AC-ASSESS-9** On a surface with `ai.default_per_surface.<surface> = false`, assess errors with guidance unless `--ai` is passed; `--no-ai` always exits 2.

**AC-ASSESS-10** MCP `lore_assess` mirrors CLI semantics; schema pre-declared as `z.object` const (ADR constraint).

**AC-ASSESS-11** `knowledgeExtraSchema` accepts `sub_type: "assessment"` with a typed `assessment` branch; all sub_type consumer sites updated (schemas, types, MCP schema-info, CLI create help, dashboard NewDocModal).

**AC-ASSESS-12** `CorpusService.getPlanBundle` returns `{plan, spec?, tasks[]}`; plan hanging off a PRD (no spec parent) → `spec` undefined, not an error; non-plan input → `VALIDATION_ERROR`.

**AC-ASSESS-13** Existing suites stay green; typecheck exit 0; both runners pass.

## 5. Judge Prompt Contract (v1 — `ASSESS_PROMPT_VERSION = 1`)

The rendered prompt MUST contain, in order:

1. **Role**: independent implementation auditor; judge only from provided materials; unverifiable claims score conservatively.
2. **Materials**: plan (goals/phases), spec ACs (verbatim), per-task evidence trails (oracle, command, result, output tail, recorder), optional diff.
3. **Rubric anchors**: 90-100 = AC fully evidenced; 60-89 = met with gaps noted; 30-59 = partially met / weakly evidenced; 0-29 = unmet or contradicted. `verdict`: met = all ACs ≥60 and overall ≥80; not_met = overall <40 or any AC = 0 with no mitigation; else partially_met.
4. **Output instruction**: single JSON object matching the embedded schema; no prose outside JSON.

## 6. Perspective Tensions Resolved (4 parallel reviewers)

| Tension | Perspectives | Resolution | Why |
|---|---|---|---|
| assessPlan home: AIProviderService vs new AssessmentService | Coupling ↔ Cohesion (direct conflict) | Keep in AIProviderService, BUT bundle fetch moves to `CorpusService.getPlanBundle` and prompts stay in `ai/` | Cohesion's real objections were store-dependency creep and a second prompt home — both eliminated; coupling's "SRP = AI dispatch" holds; `inferLinkType` remains the shape precedent; retry lives in a sibling helper so the four existing methods keep their simple contract |
| Bundle assembly location | Coupling + Cohesion (agreed) | `CorpusService.getPlanBundle` | Adapter contract forbids multi-fetch orchestration; CorpusService already owns read orchestration (`tree`) |
| Judge metadata shape | Extension | Nested `judgment` + `scope` discriminator now | Near-zero cost insurance against ensemble/task-scope reshape |
| Budgets: constants vs config | Extension ↔ simplicity | Config (`ai.assess.*`) | `ai.refine.max_input_chars` precedent makes constants the inconsistent choice |
| Retry testability | Testability | Sequence mode on InMemoryAIProvider (D9); extraction as pure core fn | Single-valued `setMode` cannot script malformed→valid; pure fn gets fence-variant coverage without provider machinery |
| git diff hermeticity | Testability ↔ ceremony | `--diff-file` flag as the seam; one real-git fixture integration test | Mirrors `--content-file` idiom; a DiffSource interface would be over-engineering |

## 7. Test Guidance (for the tester agent)

- **Pure core** (vitest, task-workflow.test.ts precedent): `extractAssessmentJson` — bare JSON, ```json fences, ``` fences, prose-wrapped, truncated JSON, empty string, JSON array (not object); truncation helpers — exact budget boundary, over-budget records section name; `renderAssessmentContent` determinism (no Date/random).
- **Service** (vitest + InMemoryStore + sequence-mode provider): retry success (`retried=true`), double-failure (no doc side effects — assert store unchanged), telemetry exactly-once (success AND failure paths), evidence-bearing bundle flows into prompt (assert prompt contains evidence markers via provider capture).
- **getPlanBundle** (vitest + InMemoryStore): plan+spec+tasks happy path; PRD-parented plan (spec undefined); non-plan id → VALIDATION_ERROR; task evidence included.
- **CLI** (integration, task-workflow.test.ts subprocess pattern): translation-only + exit codes; `--diff-file` hermetic case; ONE real-git fixture case (`git init` temp repo + commit + `--diff HEAD~1..HEAD`); `--diff`+`--diff-file` conflict exits 2.
- **MCP**: envelope shape for lore_assess (mcp-tools test pattern).
- Six-dimension mapping: HAPPY (full assess round-trip), NEGATIVE (no-task plan, no provider, surface brake), BOUNDARY (budget truncation, empty diff), ERROR (double malformed, provider timeout passthrough), STATE (append-only re-assessment produces second doc), REGRESSION (existing knowledge sub_types unaffected, existing AI ops unaffected by sequence-mode addition).

## 8. Architecture (implementation-ready)

### 8.1 File touch list

| File | Change |
|---|---|
| `packages/core/src/assessment.ts` | **NEW** (browser-safe, pure): `assessmentResultSchema` (+ nested `judgmentSchema`, `acScoreSchema`, `evidenceRefSchema`, `scopeSchema`), `planBundleSchema`, `extractAssessmentJson(raw): Result<unknown, LoreError>`, truncation helpers, `renderAssessmentContent(result): string` |
| `packages/core/src/schemas.ts` | MOD: `knowledgeExtraSchema` sub_type enum += `"assessment"`; typed `assessment` branch (superRefine: sub_type=assessment requires valid `extra.assessment`) |
| `packages/core/src/ai.ts` | MOD: `AiConfigSchema` += `assess: { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 }` (all int positive with defaults) |
| `packages/lore/src/ai/templates.ts` (or sibling `assess-template.ts`) | MOD/NEW: judge prompt template per §5 + `ASSESS_PROMPT_VERSION` |
| `packages/lore/src/ai/in-memory-provider.ts` | MOD: sequence mode (FIFO scripted responses) alongside existing single mode |
| `packages/lore/src/service/corpus-service.ts` | MOD: `getPlanBundle(planIdOrSlug): Promise<Result<PlanBundle, LoreError>>` |
| `packages/lore/src/service/ai-provider-service.ts` | MOD: `assessPlan(bundle, opts: {diffText?, source?}): Promise<Result<AssessmentResult, LoreError>>` + private retry sibling helper |
| `packages/lore/src/adapters/cli/commands/assess.ts` | **NEW**: resolve → getPlanBundle → (diff via git subprocess or file) → assessPlan → create knowledge + link informs → render; exit-code mapping |
| `packages/lore/src/adapters/cli/index.ts` | MOD: register `assess` |
| `packages/lore/src/adapters/mcp/tools.ts` | MOD: `lore_assess` (pre-declared z.object) |
| Dashboard `NewDocModal` + MCP `schema-info.ts` + CLI `create.ts` help | MOD: sub_type consumer sites (AC-ASSESS-11) |

### 8.2 Public interface (TypeScript)

```ts
// packages/core/src/assessment.ts (browser-safe, pure)
export interface EvidenceRef { doc_id: string; note?: string }
export interface AcScore { ac_id: string; score: number /* 0-100 int */; reasoning: string /* ≤300 chars */; evidence_refs: EvidenceRef[] }
export interface Judgment {
  provider: string; prompt_version: number; duration_ms: number;
  retried: boolean; truncated: string[];  // section names the judge did not fully see
}
export interface AssessmentResult {
  scope: { type: "plan" | "task"; id: string };   // v1 always "plan"
  verdict: "met" | "partially_met" | "not_met";
  overall_score: number;                            // 0-100 int
  ac_scores: AcScore[];
  gaps: string[];
  recommendations: string[];
  judgment: Judgment;
}
export interface PlanBundle {
  plan: DocRecord;
  spec?: DocRecord;                                  // undefined when plan hangs off a PRD
  tasks: DocRecord[];                                // includes extra.verification_evidence
}
export function extractAssessmentJson(raw: string): Result<unknown, LoreError>;
export function renderAssessmentContent(result: AssessmentResult): string;

// packages/lore/src/service/corpus-service.ts
getPlanBundle(planIdOrSlug: string): Promise<Result<PlanBundle, LoreError>>;

// packages/lore/src/service/ai-provider-service.ts
assessPlan(bundle: PlanBundle, opts: { diffText?: string; source?: string }): Promise<Result<AssessmentResult, LoreError>>;
```

### 8.3 Adapter flow (`lore assess`)

```
resolve plan → corpusService.getPlanBundle
             → [--diff: spawn git diff <range> | --diff-file: readFile]   (CLI layer only)
             → aiProviderService.assessPlan(bundle, {diffText, source: app.callerSurface})
             → corpusService.create({ type: "knowledge", title: `Assessment: <plan title> (<date from result — CLI supplies>)`,
                                       parent_id: plan.id, extra: { sub_type: "assessment", assessment: result },
                                       content: renderAssessmentContent(result) })
             → corpusService.link(assessmentId, planId, "informs")
             → render verdict + score table (or --json envelope)
```

## 9. Risks

| Risk | Mitigation |
|---|---|
| Judge grades on truncated inputs and misjudges | Truncation is visible (`judgment.truncated`), budgets configurable; readers see exactly what the judge saw |
| LLM verdict inconsistency across runs | Judgments are advisory + append-only with full audit metadata; no gating semantics (Non-goal); rubric anchors (§5) reduce variance |
| Assessment content/extra divergence (two views of one datum) | `extra.assessment` is SSOT; `content` is generated ONLY by `renderAssessmentContent` at creation; editing assessment docs manually is socially discouraged (they're judgments, not living docs) |
| Provider cost on large plans | Budgets cap prompt size ≈ 48k chars worst case; single retry bound |
| Nested-claude on agent surfaces | D5 config brake + explicit command name; telemetry records every run |

## 10. Dogfood validation (part of this iteration's DoD)

The closeout task runs `lore assess plan-spec-026-implementation-...` — the feature judges its own implementation plan, with SPEC-025 claim/evidence trails as its material. The resulting assessment doc is the feedback loop's first real artifact.


## Acceptance Criteria (structured)

- [·] [script] AC-ASSESS-14: With neither --diff nor --diff-file supplied, the diff assess sends to the judge contains the plan's own commits and excludes every foreign commit interleaved among them
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts -t 'PRIMARY ORACLE: excludes every interleaved foreign commit from the prompt sent to the judge'
- [·] [script] AC-ASSESS-15: When no commit anywhere references any of the plan's task slugs, assess reports a named outcome rather than a silent empty diff presented as audited
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-tools-assess.test.ts -t 'BOUNDARY: no commit anywhere references either task slug'

## Code anchors

- packages/lore/src/ai/assess-template.ts
