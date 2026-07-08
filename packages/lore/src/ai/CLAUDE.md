# Module: ai

## Purpose

Runtime AI provider implementations, registry builder, template engine, assess judge prompt builder, AI-default resolution, and in-memory test double. Wires the `AIProvider` interface (defined type-only in `@lore/core`) to concrete spawn-based execution. Six files cover: CLI spawner, registry, template rendering, AI-default resolution, assess prompt builder, and test double.

## Key Invariants

- **Type-only interface in `@lore/core`, concrete classes here** — `AIProvider` is declared in `packages/core/src/ai.ts` and imported by `ClaudeCliProvider` and `InMemoryAIProvider` via `@lore/core`. No reverse dependency: `@lore/core` never imports from `packages/lore/src/ai/`.
- **All providers use ClaudeCliProvider in v1** — `buildProviderRegistry` constructs a `ClaudeCliProvider` for every entry in the merged config map. A future SPEC (not this one) will add a `kind` discriminator and an `HttpProvider` class.
- **User provider entries REPLACE whole built-in entries** — no deep-merge. The user owns the full `{ command, args, timeout_ms }` block or none.
- **InMemoryAIProvider ships in src/ not tests/** — so any test in any package (including `@lore/core` tests) can import it without path hacks.
- **Never throw** — all public async methods return `Promise<Result<T, LoreError>>`. `ClaudeCliProvider.generate` wraps `Bun.spawn` in try/catch to map ENOENT to `AI_PROVIDER_ERROR`.
- **assess judge prompt lives here, NOT in `@lore/core`** (SPEC-026 §3 D8) — `assess-template.ts` owns the prompt text and `ASSESS_PROMPT_VERSION`; `@lore/core`'s `assessment.ts` stays limited to schemas + pure data helpers (truncation, JSON extraction, content rendering), matching the `task-workflow.ts` precedent of "core = schemas + pure helpers, no prompt strings."
- **Diff-omission truncation manifest (bugfix F3, `ASSESS_PROMPT_VERSION` 2→3)** — when `truncateDiffByFile` drops any diff files entirely, `buildAssessPrompt` (`assess-template.ts`) appends a "Truncation Manifest" section (grouped production/test/other via `classifyDiffFilePriority`) listing every dropped path plus a hard instruction not to score it as missing. Built from the SAME `diffResult.omittedFiles` array that feeds `truncated[]` — no second bookkeeping. Fixes an observed judge failure mode (`knowledge-assess-diff-truncation-systematically-hides-tests-from`): with no manifest, the judge couldn't tell "file absent" from "file cut for budget" and systematically under-scored test-coverage ACs whose test files sorted into the dropped set. Spec/plan/task section truncation is unaffected — still bare `truncated[]` entries, no manifest (those sections aren't split per-file).
- **Structured AC table (SPEC-038 §5, `ASSESS_PROMPT_VERSION` 3→4)** — when the plan's linked spec declares `extra.acceptance_criteria` (`extractDeclaredAcceptanceCriteria`, `assess-template.ts`), `buildAssessPrompt` replaces the "Spec Acceptance Criteria (verbatim)" prose section with a deterministic `id | statement | verify | coverage` table (`renderStructuredAcTable`, coverage from `@lore/core`'s `computeAcCoverage` — this module renders, core computes facts, per SPEC-038 §7 D6) and tightens the output instruction to `ac_id MUST be one of: <declared list>` plus a script-mode evidence-priority note. A spec with NO declared criteria renders byte-identical to v3 (verbatim fallback). `BuildAssessPromptResult.declaredAcIds` carries the same extracted id list out to `AIProviderService.assessPlan`, which uses it to build the `Set` for `validateAcIdContainment` (SPEC-038 §5 D5, in `../service/ai-provider-service.ts`) — one extraction site, no drift between what the prompt showed the judge and what the containment check enforces.
- **review judge prompt (SPEC-034) lives here too, same split** — `review-template.ts` owns `REVIEW_PROMPT_VERSION` (string, e.g. `"v1"` — unlike assess's numeric `ASSESS_PROMPT_VERSION`, this one is a string because `judgeIdentitySchema.prompt_version` is `z.string()`) and a version-keyed `REVIEW_TEMPLATES: Record<string, ReviewTemplateFn>` registry (one entry today; a future prompt A/B spec adds a key rather than mutating the existing one). `@lore/core`'s `review-checks.ts` stays limited to the pure `runDeterministicChecks` fn — no prompt strings there either.
- **`InMemoryAIProvider`'s `sequence` mode mutates its own `responses` array via `shift()`** (SPEC-026 D9) — FIFO, one scripted response consumed per `generate()` call. Exhausting the script (more calls than responses) returns `AI_PROVIDER_ERROR` rather than silently reusing the last response — a test that under-scripts its sequence is a test bug, and this fails loud instead of masking it.

## Patterns

- **No module-level IO** — `ClaudeCliProvider` only spawns inside `generate()`, never in the constructor. Registry construction is purely synchronous object creation.
- **Timeout watchdog** — `setTimeout` + `proc.kill("SIGTERM")` + `clearTimeout` on normal completion. The killer timer is always cleared to prevent stale-timer surprises on reuse.
- **Hermetic judge spawn (SPEC-030 AC-HJ-1)** — `ClaudeCliProvider.generate` never builds `Bun.spawn`'s `cwd`/`env`/`args` inline. It calls `buildHermeticSpawnSpec(cfg, {sourceEnv: process.env, tmpDir: tmpdir()})` (`hermetic-spawn.ts`), a pure function so the sanitization logic is vitest-testable even though the callsite is bun-only. The spec: neutral cwd (OS tmpdir, not the host project dir), a sanitized env (denylist strips `CLAUDECODE` + `CLAUDE_*`, everything else — including auth vars — passes through), and, ONLY when the configured command's basename is `claude`, the official `--setting-sources ""` isolation flag appended to args (probed via `claude --help`; `--bare` was rejected because it restricts auth to `ANTHROPIC_API_KEY`/`apiKeyHelper` only). A custom judge command (any other basename) gets no injected flag.
- **Template rendering is two-pass** — conditionals (`{{#key}}…{{/key}}`) before substitutions (`{{key}}`), to prevent partial expansion of vars inside a collapsed block.
- **assess has no non-AI mode** (SPEC-026 §3 D5) — `resolve-ai.ts::isAssessAiBraked(resolveAiDefault(undefined, surface, configDefaults))` is the only correct way to gate it: the built-in per-surface AI-off default (agent/mcp/http_token) must NOT brake assess, only an EXPLICIT `ai.default_per_surface.<surface> = false` config override should. Checking `resolveAiDefault(...).ai === false` directly (without the source-tier check) is a bug — it braked assess on every agent/mcp call, defeating D5's entire point.

## Files

| File | Role |
|------|------|
| `claude-cli-provider.ts` | `ClaudeCliProvider` — Bun.spawn-based provider; implements `AIProvider` |
| `hermetic-spawn.ts` | `buildHermeticSpawnSpec`, `sanitizeSpawnEnv`, `isClaudeCliCommand` — pure spawn-param builders for judge isolation (SPEC-030 AC-HJ-1); vitest-testable |
| `in-memory-provider.ts` | `InMemoryAIProvider` — test double; configurable mode (`ok` \| `err` \| `sequence`); records all `generate()` calls |
| `registry.ts` | `buildProviderRegistry(config)` — merges built-ins + user overrides, validates active provider |
| `templates.ts` | `BUILT_IN_TEMPLATES`, `REFINE_TEMPLATE`, `LINK_INFERENCE_TEMPLATE`, `renderTemplate(tpl, vars)` — minimal mustache-subset renderer |
| `resolve-ai.ts` | `resolveAiDefault(explicit, surface, configDefaults?)` (SPEC-024), `isAssessAiBraked(resolved)` (SPEC-026 D5) |
| `assess-template.ts` | `ASSESS_PROMPT_VERSION`, `buildAssessPrompt(bundle, diffText, budgets)`, `buildAssessRetryPrompt(prompt, parseError)` (SPEC-026); `extractDeclaredAcceptanceCriteria(spec)` (SPEC-038 §5) |
| `review-template.ts` | `REVIEW_PROMPT_VERSION`, `REVIEW_TEMPLATES` registry, `buildReviewRetryPrompt(prompt, parseError)` (SPEC-034) |

## Links

- Depends on: [`@lore/core`](../../../../core/src/CLAUDE.md) (for `AIProvider`, `AiProviderConfig`, `AiConfig`, `PlanBundle`, `Result`, `ok`, `err`, `truncateSection`, `evidenceEntrySchema`, `computeAcCoverage`, `specAcceptanceCriteriaSchema`, `AcceptanceCriterion`, `DocRecord`)
- Used by: [`../service/ai-provider-service.ts`](../service/ai-provider-service.ts) (via registry + provider map + assess-template), [`../../app.ts`](../../app.ts) (via `buildProviderRegistry`), [`../adapters/mcp/tools.ts`](../adapters/mcp/CLAUDE.md) and [`../adapters/cli/commands/assess.ts`](../adapters/cli/CLAUDE.md) (via `isAssessAiBraked`).
- Source: SPEC-017, SPEC-024, SPEC-026, SPEC-038
