# Eval Patterns — @harness/eval

## Dual-Mode Architecture

`runEval` detects `LANGFUSE_PUBLIC_KEY` env var:
- **Present**: sends to Langfuse `experiment.run()` — persistent datasets, experiment comparison, scoring dashboard
- **Absent**: runs offline with local scoring — same EvalResult shape, CI-friendly

## Writing Evaluators

```typescript
import { type Evaluator } from "@harness/eval";

// Simple keyword check
const keywordCoverage: Evaluator = ({ output, metadata }) => {
  const keywords = metadata?.requiredKeywords as string[] ?? [];
  if (keywords.length === 0) return { name: "keyword-coverage", value: 0 };
  const lower = output.toLowerCase();
  const hits = keywords.filter(kw => lower.includes(kw.toLowerCase())).length;
  return { name: "keyword-coverage", value: hits / keywords.length };
};

// Golden output comparison
const groundTruthMatch: Evaluator = ({ output, expectedOutput }) => {
  if (!expectedOutput) return { name: "ground-truth-match", value: 0 };
  const lower = output.toLowerCase();
  const golden = expectedOutput.toLowerCase();
  const sentences = golden.split(/[.;]/).map(s => s.trim()).filter(s => s.length > 10);
  if (sentences.length === 0) return { name: "ground-truth-match", value: 0 };
  const hits = sentences.filter(s => {
    const words = s.split(/\s+/).filter(w => w.length > 3);
    return words.filter(w => lower.includes(w)).length / words.length >= 0.6;
  }).length;
  return { name: "ground-truth-match", value: hits / sentences.length };
};

// Binary pass/fail
const containsAnswer: Evaluator = ({ output, expectedOutput }) => ({
  name: "contains-answer",
  value: output.toLowerCase().includes((expectedOutput ?? "").toLowerCase()) ? 1 : 0,
});
```

## Evaluator Signature

```typescript
type Evaluator = (params: {
  input: string;
  output: string;
  expectedOutput?: string;
  metadata?: Record<string, unknown>;
}) => EvalScore | Promise<EvalScore>;

interface EvalScore {
  name: string;
  value: number;  // 0-1 scale recommended
  comment?: string;
}
```

## Eval Case Format

```typescript
interface EvalCase {
  input: string;
  expectedOutput?: string;
  metadata?: Record<string, unknown>;
}
```

## Complete Example

```typescript
import { runEval, type Evaluator } from "@harness/eval";
import { createHarness, defineMode, defineRegistry } from "@harness/core";
import { defineModel } from "@harness/core";

const harness = createHarness({ registry, model });

const accuracy: Evaluator = ({ output, expectedOutput }) => ({
  name: "accuracy",
  value: output.includes(expectedOutput ?? "") ? 1 : 0,
});

const result = await runEval({
  name: "my-agent-v1",
  cases: [
    { input: "What is 2+2?", expectedOutput: "4" },
    { input: "Capital of France?", expectedOutput: "Paris" },
  ],
  task: async (input) => {
    const { text } = await harness.run(input);
    return text;
  },
  evaluators: [accuracy],
  threshold: 0.8,
});

// result.mode = 'langfuse' | 'offline'
// result.passed / result.failed / result.total
console.log(JSON.stringify(result, null, 2));
process.exit(result.failed > 0 ? 1 : 0);
```

## Langfuse Dashboard

When running with Langfuse credentials:
- Each `runEval` creates a Langfuse **experiment**
- Each case becomes an **experiment item** with input/output/scores
- Compare experiments across versions in the Langfuse UI
- Score traces post-hoc via `langfuse.score.trace()`
