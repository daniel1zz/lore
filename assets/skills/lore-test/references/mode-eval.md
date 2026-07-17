# Test Mode: eval

**Purpose**: Business/semantic quality evaluation for output-producing features
→ Closes L3 quality gap (L1=compile, L2=functional, **L3=business quality**, L4=UX)

## When to Use
- AI/LLM features: chat, generation, summarization, agents
- Search/ranking/recommendation systems
- Content generation: reports, notifications, emails
- Any feature where "works" ≠ "works well"

## Tooling

| Tool | Role | Install | Usage |
|------|------|---------|-------|
| **promptfoo** | Eval runner (YAML-driven, CI/CD) | `npm i -D promptfoo` | `npx promptfoo eval` |
| **autoevals** | Programmatic scorers (in Vitest) | `npm i -D autoevals` | Import scorers in test files |
| **AI SDK** | Custom LLM-as-Judge (Tier 3) | Already installed | `generateText` + `Output.object()` |

**Decision**: promptfoo for CI/CD eval suites, autoevals for inline test assertions, custom judge only for domain-specific dimensions not covered by either. Per Research-First: use mature SDKs, don't self-implement.

## Evaluation Dimensions (3 Tiers)

### Tier 1 — Core (any output-producing code)

Always evaluate when target produces user-visible output.

| Dimension | What It Measures | promptfoo Assertion | autoevals Scorer | Default Threshold |
|-----------|-----------------|---------------------|------------------|-------------------|
| **Relevance** | Output addresses the input | `answer-relevance` | `AnswerRelevancy` | ≥ 0.8 |
| **Accuracy** | Output is factually correct | `factuality`, `model-graded-factuality` | `Factuality`, `ClosedQA` | ≥ 0.85 |
| **Completeness** | Output covers expected info | `llm-rubric` (custom rubric) | Custom scorer | ≥ 0.8 |
| **Safety** | No harmful/toxic/biased content | `moderation`, `guardrails` | `Moderation` | ≥ 0.95 |

### Tier 2 — AI-specific (LLM/agent code)

Evaluate when target uses LLM APIs (AI SDK, OpenAI, Anthropic, etc.).

| Dimension | What It Measures | promptfoo Assertion | autoevals Scorer | Default Threshold |
|-----------|-----------------|---------------------|------------------|-------------------|
| **Faithfulness** | Claims grounded in context | `context-faithfulness` | `Faithfulness` | ≥ 0.9 |
| **Hallucination** | No fabricated information | inverse of faithfulness | `Faithfulness` (inverse) | ≥ 0.9 |
| **Task Completion** | Agent completed the task | `llm-rubric` (task rubric) | Custom scorer | ≥ 0.8 |
| **Tool Use** | Correct tool selection + args | `tool-call-f1` | — | ≥ 0.85 |

### Tier 3 — Domain-specific (configurable per project)

Evaluate based on feature type. Use custom LLM-as-Judge or domain metrics.

| Feature Type | Dimensions | Metrics |
|-------------|-----------|---------|
| Search | Ranking quality, recall | nDCG@k, MAP, recall@k |
| Recommendation | Diversity, coverage, serendipity | ILS, catalog coverage |
| Summarization | Compression, key info retention | ROUGE, BERTScore, `Summary` scorer |
| Translation | Accuracy, fluency | BLEU, `Translation` scorer |
| Content gen | Coherence, style, info density | `llm-rubric` with domain rubric |

---

## 9-Step Loop

### Step 1: CONTEXT
- Detect AI config: model, provider, temperature, system prompt
- Check for existing eval infrastructure: `promptfooconfig.yaml`, eval test files
- Load feature-spec ACs with quality criteria (keywords: "relevant", "accurate", "quality")
- Check for golden datasets: `__fixtures__/eval/`, `test/eval-data/`, `*.golden.json`
- Detect target type → select applicable tier (1/2/3)

### Step 2: ANALYZE
- Identify evaluation targets using code signals:
  - AI SDK imports: `from 'ai'`, `from '@ai-sdk/*'`
  - LLM calls: `generateText`, `streamText`, `agent.generate`, `agent.stream`
  - Prompt files: `*.prompt.ts`, `*.prompt.md`, system message strings
  - Output functions: `recommend()`, `rank()`, `summarize()`, `search()`
- Categorize each target: AI / search / recommendation / content / other
- Map targets to applicable tiers

### Step 3: TECHNIQUES — Eval Design Techniques

Select based on target type and available data:

| Technique | When | How |
|-----------|------|-----|
| **Rubric-based** (GEval) | No golden set, custom quality criteria | Define scoring rubric (1-5 per dimension), LLM judges output |
| **Reference-based** | Golden set available | Compare output to reference answer (factuality, similarity) |
| **Pairwise** (A/B) | Comparing two approaches | LLM picks winner between output A and output B |
| **Metric-based** | Automated metrics exist | BLEU, ROUGE, nDCG, tool-call-f1 |
| **Property-based** | Invariants exist | "output must contain X", "output must not contain Y" |

**Selection priority**: Reference-based (if golden set) → Rubric-based (if quality criteria) → Property-based (as baseline).

### Step 4: DESIGN — Eval Suite Design

For each target, design eval cases:

```yaml
# promptfoo eval case structure
- vars:
    input: "user question or input"
    context: "relevant context (for RAG)"        # optional
    expected: "reference answer"                  # optional (for reference-based)
  assert:
    - type: answer-relevance                      # Tier 1
      threshold: 0.8
    - type: factuality                            # Tier 1
      threshold: 0.85
    - type: context-faithfulness                  # Tier 2 (if RAG)
      threshold: 0.9
    - type: moderation                            # Tier 1
    - type: llm-rubric                            # Custom rubric
      value: |
        Evaluate completeness: does the response cover all key aspects
        of the question? Score 1-5 where 5 = comprehensive.
      threshold: 0.8
```

For Vitest + autoevals:

```typescript
import { Factuality, ClosedQA, AnswerRelevancy } from 'autoevals';
import { describe, test, expect } from 'vitest';

describe('AI output quality', () => {
  test('response is factually correct', async () => {
    const output = await myAIFunction(input);
    const score = await Factuality({ input, output, expected: goldenAnswer });
    expect(score.score).toBeGreaterThanOrEqual(0.85);
  });
});
```

**Test case sources** (in priority order):
1. Feature-spec ACs with quality criteria
2. Golden dataset (pre-defined input → expected output pairs)
3. Production logs (real user inputs, sample for eval)
4. Synthetic generation (LLM generates test inputs for edge cases)

### Step 5: SETUP

**promptfoo path** — generate `promptfooconfig.yaml`:

```yaml
# Generated by test:eval mode
description: "Quality evaluation for [feature name]"

providers:
  - id: "file://src/ai/handler.ts:myFunction"  # or API endpoint
    # OR
  - id: "openai:gpt-5.4"  # via AI Gateway (route through gateway for OIDC auth)

prompts:
  - file://src/ai/prompts/system.md

tests:
  - vars: { input: "..." }
    assert:
      - type: answer-relevance
        threshold: 0.8
      # ... per-case assertions

defaultTest:
  assert:
    - type: moderation  # safety baseline for all cases

outputPath: ./eval-results.json
```

**autoevals path** — generate Vitest test file:

```typescript
// __tests__/eval/[feature].eval.test.ts
import { Factuality, AnswerRelevancy, Moderation } from 'autoevals';

const EVAL_CASES = [
  { input: '...', expected: '...', context: '...' },
  // loaded from golden set or inline
];

describe('[Feature] quality evaluation', () => {
  test.each(EVAL_CASES)('case: $input', async ({ input, expected, context }) => {
    const output = await featureUnderTest(input);

    const [relevance, factuality, safety] = await Promise.all([
      AnswerRelevancy({ input, output }),
      Factuality({ input, output, expected }),
      Moderation({ output }),
    ]);

    expect(relevance.score).toBeGreaterThanOrEqual(0.8);
    expect(factuality.score).toBeGreaterThanOrEqual(0.85);
    expect(safety.score).toBeGreaterThanOrEqual(0.95);
  });
});
```

### Step 6: EXECUTE

- **promptfoo**: `npx promptfoo eval -o eval-results.json`
- **Vitest**: `npx vitest run __tests__/eval/`
- Collect per-dimension scores, per-case pass/fail

### Step 7: GATE — Quality Gates

| Gate | Threshold | Action on Fail |
|------|-----------|----------------|
| Per-dimension score | See tier tables above | Fail eval, report dimension |
| Regression detection | Δ ≤ -0.05 from baseline | Warn — quality dropped >5% |
| Safety floor | moderation ≥ 0.95 | Hard fail — no exceptions |
| Overall weighted avg | ≥ 0.8 | Fail eval |
| Zero-tolerance assertions | `contains`, `not-contains` | Hard fail per case |

**Regression baseline**: first eval run establishes baseline (`eval-baseline.json`). Subsequent runs compare.

### Step 8: CLEANUP
- Save eval artifacts: `eval-results.json`, comparison reports
- Log cost tracking (LLM-as-Judge API calls)
- Archive per-dimension score trends

### Step 9: PERSIST
- Update the test-plan knowledge doc (`lore set <test-plan-slug> --content ...`) with eval results:
  ```
  ## Eval Results — eval ({date})
  - Tier: 1/2/3
  - Dimensions: {list with scores}
  - Cases: {pass}/{total} ({pct}%)
  - Regression: {Δ from baseline or "first run"}
  - Cost: ${amount} (judge API calls)
  - Artifacts: [eval-results.json]
  ```

---

## CI/CD Integration

### promptfoo GitHub Action

```yaml
# .github/workflows/eval.yml
name: AI Quality Eval
on:
  pull_request:
    paths:
      - 'src/ai/**'
      - 'src/prompts/**'
      - 'promptfooconfig.yaml'

jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx vercel env pull .env.local --yes  # pulls OIDC credentials for AI Gateway
        env:
          VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
          VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      - uses: promptfoo/promptfoo-action@v1
        with:
          config: promptfooconfig.yaml
          cache-path: ~/.cache/promptfoo
          env-file: .env.local  # OIDC auth — no provider API keys needed
```

### Quality gate in CI

```yaml
      - run: |
          npx promptfoo eval -o results.json
          npx promptfoo eval --grader results.json --threshold 0.8
```

---

## Preferred Libraries

| Library | Purpose | npm |
|---------|---------|-----|
| promptfoo | Eval runner, CI/CD | `promptfoo` |
| autoevals | Programmatic scorers | `autoevals` |
| @braintrust/core | Score types (used by autoevals) | `@braintrust/core` |

---

## Examples

### Minimal: Single AI endpoint eval

```yaml
# promptfooconfig.yaml
providers:
  - id: "http://localhost:3000/api/chat"
    config:
      method: POST
      body: { "message": "{{input}}" }
      responseParser: "json.response"

tests:
  - vars: { input: "What is TypeScript?" }
    assert:
      - type: answer-relevance
        threshold: 0.8
      - type: contains
        value: "programming language"
      - type: moderation
```

### Advanced: RAG system with faithfulness

```yaml
providers:
  - id: "file://src/rag/pipeline.ts:ragQuery"

tests:
  - vars:
      input: "What are the refund policies?"
      context: "file://test/fixtures/refund-policy.md"
    assert:
      - type: context-faithfulness
        threshold: 0.9
      - type: answer-relevance
        threshold: 0.8
      - type: factuality
        value: "Refunds are available within 30 days of purchase"
        threshold: 0.85
```

### Agent with tool calling

```yaml
  - vars:
      input: "Book a flight from NYC to London on March 15"
    assert:
      - type: is-valid-openai-tools-call
      - type: tool-call-f1
        threshold: 0.85
      - type: llm-rubric
        value: "The agent should search for flights, select an appropriate option, and initiate booking"
        threshold: 0.8
```
