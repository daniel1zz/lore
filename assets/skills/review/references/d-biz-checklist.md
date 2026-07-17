# D-BIZ Checklist — Business Output Quality

**Purpose**: Code review dimension for output-producing features.
Evaluates whether code will produce **good** output, not just **correct** output.

## Auto-Trigger Conditions

D-BIZ auto-appends to `mode-code` review when ANY of:

1. **Import signal**: Changed files import AI/LLM packages:
   - `'ai'`, `'@ai-sdk/*'`, `'openai'`, `'@anthropic-ai/*'`
   - `'@langchain/*'`, `'llamaindex'`
2. **Function signal**: Changed files contain:
   - `generateText`, `streamText`, `agent.generate`, `agent.stream`
   - `completion`, `chat`, `embed`, `rerank`
3. **Directory signal**: Changed files in:
   - `ai/`, `agents/`, `prompts/`, `llm/`, `ml/`
4. **Spec signal**: Feature-spec ACs contain quality keywords:
   - `relevant`, `accurate`, `quality`, `faithful`, `complete`, `coherent`
5. **Config signal**: Project contains `promptfooconfig.yaml`
6. **Explicit request**: User runs `/review code` on output-producing feature

## Checklist

### D-BIZ-PROMPT — AI/LLM Prompt Design Quality

Review when code contains system prompts, prompt templates, or LLM configuration.

| # | Check | Severity | Evidence Required |
|---|-------|----------|-------------------|
| P1 | System prompt has clear role + constraints + output format | MAJOR | Show prompt content |
| P2 | Model selection appropriate for task (reasoning vs speed vs cost) | MINOR | Model string in code |
| P3 | Temperature appropriate (0-0.3 for factual, 0.7+ for creative) | MINOR | Temperature config |
| P4 | Few-shot examples or quality rubric included when beneficial | MINOR | Prompt content |
| P5 | Output parsing handles malformed LLM responses (not just happy path) | MAJOR | Error handling code |
| P6 | Guardrails present for safety-critical features (content filter, PII, hallucination) | BLOCKER (if safety-critical) | Guardrail code/config |
| P7 | Prompt injection mitigations (input sanitization, system/user separation) | MAJOR | Input handling code |
| P8 | Token/cost limits configured (maxTokens, budget controls) | MINOR | Config values |

### D-BIZ-OUTPUT — Output Validation & Quality Assurance

Review when code produces user-visible output (AI or non-AI).

| # | Check | Severity | Evidence Required |
|---|-------|----------|-------------------|
| O1 | Output validation exists (schema check, content check, or quality gate) | MAJOR | Validation code |
| O2 | Fallback for low-quality output (retry with different params, degrade gracefully, human escalation) | MAJOR | Fallback logic |
| O3 | Empty/null output handled (not just swallowed — user sees meaningful feedback) | MINOR | Empty state handling |
| O4 | Determinism strategy for reproducible results (seed, cache, temperature=0 for factual) | MINOR | Config or caching code |
| O5 | Quality metrics logged for production observability (can you measure quality post-deploy?) | MINOR | Logging/metrics code |
| O6 | Eval infrastructure referenced (promptfoo config, eval tests, golden datasets) | MINOR | Test files or config |
| O7 | Rate limiting / throttling for external API calls (LLM, search, recommendation services) | MINOR | Rate limit code |

### D-BIZ-DOMAIN — Business Logic Semantic Correctness

Review when code encodes business rules that produce decisions or recommendations.

| # | Check | Severity | Evidence Required |
|---|-------|----------|-------------------|
| B1 | Business rules correctly encoded (not just "runs" but "produces correct decisions") | MAJOR | Rule logic vs spec |
| B2 | Edge cases in business logic handled (empty results, conflicting rules, boundary conditions) | MAJOR | Edge case handling |
| B3 | Output aligns with user expectations (format, tone, level of detail, cultural sensitivity) | MINOR | Output formatting |
| B4 | Sorting/ranking logic has documented rationale (not arbitrary `.sort()`) | MINOR | Sort criteria |
| B5 | Aggregation/calculation logic is statistically sound (correct mean/median, no floating point issues) | MAJOR | Calculation code |
| B6 | Filtering logic is inclusive (doesn't silently drop valid results) | MINOR | Filter conditions |

## Output Format

In the review summary `[DIMENSION CHECK]` block:

```
**[DIMENSION CHECK]**
- D-CODE: ✅/❌ {evidence}
- D-PERF: ✅/❌ {evidence}
- D-SEC: ✅/❌ {evidence}
- D-BIZ: ✅/❌ {evidence — cite specific P/O/B checks}
```

**D-BIZ verdict logic**:
- ✅ = No MAJOR/BLOCKER findings in applicable D-BIZ checks
- ❌ = Any MAJOR or BLOCKER in D-BIZ checks → cite check IDs (e.g., "P1, O2 failed")

## Handoff

When D-BIZ finds issues:

| Finding Type | Handoff |
|-------------|---------|
| Missing eval infrastructure (O6) | → `Skill('test', 'eval')` — add quality eval suite |
| Prompt design issues (P1-P8) | → fix prompt inline or via downstream task |
| Missing output validation (O1-O2) | → add validation inline or via downstream task |
| Business rule errors (B1-B6) | → `Skill('diagnose', 'bug')` — verify correct behavior |
