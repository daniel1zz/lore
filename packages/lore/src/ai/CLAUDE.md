# Module: ai

Architecture card: `baseline-module-card-ai`

## Purpose

Runtime AI provider implementations, registry builder, template engine, assess/review judge prompt builders, AI-default resolution, and in-memory test double. Wires the `AIProvider` interface (defined type-only in `@lore/core`) to concrete spawn-based execution.

Full pre-eviction file (per-prompt-version change narratives, per-spec design decisions, measured judge failure modes) is archived verbatim: `lore get knowledge-module-claude-md-snapshot-packages-lore-src-ai-frozen`.

## Key Invariants

- **Type-only interface in `@lore/core`, concrete classes here** — `AIProvider` is declared in `packages/core/src/ai.ts` and imported by `ClaudeCliProvider`/`InMemoryAIProvider` via `@lore/core`. ⛔ No reverse dependency: `@lore/core` never imports from `packages/lore/src/ai/`.
- **All providers use ClaudeCliProvider in v1** — `buildProviderRegistry` constructs one for every entry in the merged config map. A future SPEC adds a `kind` discriminator and an `HttpProvider`.
- **User provider entries REPLACE whole built-in entries** — no deep-merge. The user owns the full `{ command, args, timeout_ms }` block or none.
- **`InMemoryAIProvider` ships in src/ not tests/** — so any test in any package (including `@lore/core`'s) can import it without path hacks.
- **Never throw** — all public async methods return `Promise<Result<T, LoreError>>`. `ClaudeCliProvider.generate` wraps `Bun.spawn` in try/catch to map ENOENT to `AI_PROVIDER_ERROR`.
- **Prompt TEXT lives here, never in `@lore/core`** (SPEC-026 D8) — `milestone-review-template.ts` owns `MILESTONE_REVIEW_PROMPT_VERSION` (the one `lore assess` prompt, BR-1372), `review-template.ts` owns `REVIEW_PROMPT_VERSION`. `@lore/core`'s `milestone-review.ts`/`review-checks.ts` stay limited to schemas + pure data helpers, matching the `task-workflow.ts` precedent: core = schemas + pure helpers, no prompt strings. The retired plan-outcome prompt (`assess-template.ts`) is gone; its stored `assessment` docs stay readable through `assessment.ts`'s schema.
- **The review prompt family is a VERSION-KEYED REGISTRY, and a landed version is FROZEN** — `REVIEW_TEMPLATES: Record<string, ReviewTemplateFn>`. ⛔ A new prompt spec ADDS a key; it never mutates an existing one. Byte-identity of `buildReviewPromptV1` is locked by the `tests/fixtures/review-prompt-v1.txt` fixture, and every "no structured input" fallback path (a spec with 0 declared ACs, a non-spec doc) must render byte-identically to the previous version. The milestone prompt is a single versioned builder: `buildMilestoneReviewPrompt` names all seven dimensions from `MILESTONE_DIMENSIONS` and says so when the diff is cut or absent.
- **A truncation notice must NAME what was cut, or it fails both ways** — "present but unseen" alone was measured to produce both a false "missing" escalation and an obedient judge that could not say which references were unverifiable. So: `truncateDiffByFile` dropping files makes `buildMilestoneReviewPrompt` say the diff was cut by file and that the files not shown were not reviewed; and `extractSectionHeadings` scans the FULL parent content (⛔ never the truncated copy — vacuous otherwise), splitting shown/omitted at `contextSection.text.length` (⛔ not `max_context_chars`, which can differ at a surrogate-pair boundary). ⛔ Never a silent empty list: zero headings → "cannot be named", all shown → "every heading visible", none shown → a loud "NONE visible" prefix. ⛔ **From v6 the document under review is NEVER cut** (BR-268, D9): only the parent context keeps a budget (`max_context_chars`); a body the provider cannot take is an AI failure (exit 6), and a v6 judgment is never stamped `truncated`. v1-v5 stay frozen and still cut at `max_doc_chars` (default `FROZEN_DOC_CHARS`) — `assembleReviewPrompt`'s `wholeDocument` flag is set only by v6; v6 also renders baseline rule examples and declared commands (BR-960). A stored `truncated` judgment of ANY version can never approve (BR-269, `JUDGMENT_INPUT_TRUNCATED`). Rationale: `knowledge-assess-diff-truncation-systematically-hides-tests-from`.
- **The review judge has no advisory dimension** (BR-1369) — its output contract is decision, confidence, reasons, blocking_questions (+ optional `superseded_candidate`). The AC-quantifiability advisory (section, `advisory[]` field, `ADVISORY_ONLY_CLAUSE`) and the v2 prompt were removed; v3-v6 no longer render it either, and `v7` is the active key so a stored `judge.prompt_version` tells which contract produced it. Deterministic AC-quantifiability stays a gate in `@lore/core`, never a prompt.
- **`InMemoryAIProvider`'s `sequence` mode is FIFO and fails loud when exhausted** (SPEC-026 D9) — `shift()` per `generate()`; more calls than responses returns `AI_PROVIDER_ERROR` rather than silently reusing the last response. A test that under-scripts its sequence is a test bug, and this surfaces it instead of masking it.

## Patterns

- **No module-level IO** — `ClaudeCliProvider` only spawns inside `generate()`, never in the constructor. Registry construction is purely synchronous object creation.
- **Timeout watchdog** — `setTimeout` + `proc.kill("SIGTERM")` + `clearTimeout` on normal completion. The killer timer is ALWAYS cleared, to prevent stale-timer surprises on reuse.
- **Hermetic judge spawn (SPEC-030 AC-HJ-1)** — `generate` never builds `Bun.spawn`'s `cwd`/`env`/`args` inline; it calls `buildHermeticSpawnSpec(cfg, {sourceEnv, tmpDir})` (`hermetic-spawn.ts`), a pure function so the sanitization is vitest-testable even though the call site is bun-only. The spec: neutral cwd (OS tmpdir, not the host project dir), sanitized env (denylist strips `CLAUDECODE` + `CLAUDE_*`; everything else, including auth vars, passes through), and — ONLY when the configured command's basename is `claude` — the official `--setting-sources ""` isolation flag. A custom judge command gets no injected flag. (`--bare` was rejected: it restricts auth to `ANTHROPIC_API_KEY`/`apiKeyHelper` only.)
- **Template rendering is two-pass** — conditionals (`{{#key}}…{{/key}}`) before substitutions (`{{key}}`), so vars inside a collapsed block never partially expand.
- **assess has no non-AI mode** (SPEC-026 D5) — `isAssessAiBraked(resolveAiDefault(undefined, surface, configDefaults))` is the ONLY correct gate: the built-in per-surface AI-off default (agent/mcp/http_token) must NOT brake assess, only an EXPLICIT config override should. ⛔ Checking `resolveAiDefault(...).ai === false` directly, without the source-tier check, braked assess on every agent/mcp call and defeated D5 entirely.

## Files

| File | Role |
|------|------|
| `claude-cli-provider.ts` | `ClaudeCliProvider` — Bun.spawn-based provider; implements `AIProvider` |
| `hermetic-spawn.ts` | `buildHermeticSpawnSpec`, `sanitizeSpawnEnv`, `isClaudeCliCommand` — pure spawn-param builders; vitest-testable |
| `in-memory-provider.ts` | `InMemoryAIProvider` — test double; mode `ok`\|`err`\|`sequence`; records all `generate()` calls |
| `registry.ts` | `buildProviderRegistry(config)` — merges built-ins + user overrides, validates the active provider |
| `templates.ts` | `BUILT_IN_TEMPLATES`, `REFINE_TEMPLATE`, `LINK_INFERENCE_TEMPLATE`, `renderTemplate` — minimal mustache-subset renderer |
| `resolve-ai.ts` | `resolveAiDefault` (SPEC-024), `isAssessAiBraked` (SPEC-026 D5) |
| `milestone-review-template.ts` | `MILESTONE_REVIEW_PROMPT_VERSION`, `buildMilestoneReviewPrompt` — the `lore assess` prompt: plan, spec, tasks with attested evidence, cited-rule state, milestone decisions and the (file-truncated) landed diff → seven-dimension JSON |
| `review-template.ts` | `REVIEW_PROMPT_VERSION`, `REVIEW_TEMPLATES` (v7 active; v1 and v3-v6 frozen, no v2), `assembleReviewPrompt`/`buildReviewPromptV1`/`V3`, `extractSectionHeadings`/`buildOmittedSectionsNotice`, `buildReviewRetryPrompt` |
| `context-narrative-template.ts` | `lore context` narrative prompt text |
| `staleness-template.ts` | `lore review --staleness` probe prompt text |
| `env-resolve.ts` | provider env-var resolution helpers |
| `http-provider.ts` | HTTP-transport provider (registry not yet routed to it — see the `kind`-discriminator invariant) |

## Links

- Depends on: [`@lore/core`](../../../../core/src/CLAUDE.md) (`AIProvider`, `AiProviderConfig`, `AiConfig`, `PlanBundle`, `Result`/`ok`/`err`/`LoreError`, `truncateSection`, `evidenceEntrySchema`, `computeAcCoverage`, `computeAssessmentFacts`, `AssessmentFacts`, `DiffMeta`, `specAcceptanceCriteriaSchema`, `AcceptanceCriterion`, `DocRecord`, `ReviewBundle`).
- Used by: [`../service/ai-provider-service.ts`](../service/CLAUDE.md) (registry + provider map + templates), [`../../app.ts`](../../app.ts) (`buildProviderRegistry`), [`../adapters/mcp`](../adapters/mcp/CLAUDE.md) and [`../adapters/cli`](../adapters/cli/CLAUDE.md) (`isAssessAiBraked`).
- Source: SPEC-017, SPEC-024, SPEC-026, SPEC-030, SPEC-034, SPEC-038, SPEC-039, SPEC-040, SPEC-053.
