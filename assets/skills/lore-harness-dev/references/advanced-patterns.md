# Advanced Patterns

## Multi-Tool Orchestration

Tools don't call each other directly. The agent's LLM decides tool ordering. Design tools as independent units — the LLM chains them via its reasoning loop.

```typescript
// Tool 1: Extract text from PDF via external API
const pdfExtract = defineTool({
  id: "pdf.extract",
  description: "Extract text content from a PDF file via API",
  inputSchema: z.object({ url: z.string() }),
  outputSchema: z.object({ text: z.string(), pages: z.number() }),
  metadata: { category: "network", access: "read", danger: "low",
    reversibility: "reversible", idempotency: "idempotent", cost: "moderate",
    cloudSafe: true, tags: [] },
  execute: async ({ url }) => {
    const res = await fetch(`https://api.pdf-extract.com/v1/parse?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    return { text: data.text, pages: data.page_count };
  },
});

// Tool 2: Summarize text (pure compute, agent calls after extract)
const summarize = defineTool({
  id: "text.summarize",
  description: "Summarize long text into key points",
  inputSchema: z.object({ text: z.string(), maxPoints: z.number().default(5) }),
  outputSchema: z.object({ summary: z.string() }),
  metadata: { category: "compute", access: "read", danger: "safe",
    reversibility: "reversible", idempotency: "idempotent", cost: "free",
    cloudSafe: true, tags: [] },
  execute: async ({ text, maxPoints }) => {
    return { summary: text.slice(0, 500) }; // placeholder — LLM does actual summarization
  },
});

// Registry with both tools — LLM decides to call extract first, then summarize
const registry = defineRegistry({
  id: "pdf-summarizer",
  instructions: `You summarize PDF documents. Workflow:
1. Use pdf.extract to get the text from the PDF URL
2. Use text.summarize to create a concise summary
Always extract before summarizing.`,
  tools: [pdfExtract, summarize],
  defaultMode: defineMode({ id: "react", config: { kind: "react", maxIterations: 5 } }),
});
```

The key: **instructions guide the LLM's tool-use order**, not code. Use `react` mode for multi-step tool loops.

## External API Tool Templates

### Notion KB Search
```typescript
const notionSearch = defineTool({
  id: "notion.search",
  description: "Search Notion knowledge base for relevant articles",
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.object({
    title: z.string(), content: z.string(), url: z.string(),
  })) }),
  metadata: { category: "network", access: "read", danger: "low",
    reversibility: "reversible", idempotency: "idempotent", cost: "cheap",
    cloudSafe: true, tags: ["kb"] },
  execute: async ({ query }) => {
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.NOTION_API_KEY}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, page_size: 5 }),
    });
    const data = await res.json();
    return {
      results: data.results.map((r: any) => ({
        title: r.properties?.title?.title?.[0]?.plain_text ?? "Untitled",
        content: r.properties?.content?.rich_text?.[0]?.plain_text ?? "",
        url: r.url,
      })),
    };
  },
});
```

### Database Query
```typescript
const dbQuery = defineTool({
  id: "db.query",
  description: "Query order database for customer information",
  inputSchema: z.object({ orderId: z.string() }),
  outputSchema: z.object({ status: z.string(), items: z.array(z.string()) }),
  metadata: { category: "data", access: "read", danger: "safe",
    reversibility: "reversible", idempotency: "idempotent", cost: "cheap",
    cloudSafe: true, tags: [] },
  execute: async ({ orderId }) => {
    // Your DB query here
    return { status: "shipped", items: ["Widget A", "Gadget B"] };
  },
});
```

## Escalation Pattern (Hook-based)

Use a `tool.after` Hook to detect low-confidence answers and trigger escalation:

```typescript
import { defineHook } from "@harness/core";

const escalationHook = defineHook({
  id: "escalation-detector",
  events: ["agent.finish"],
  handler: async (event, ctx) => {
    const output = (event.payload as { text?: string }).text ?? "";

    // Detect uncertainty signals in agent output
    const uncertainPhrases = ["I'm not sure", "I don't have", "please contact", "unable to"];
    const needsEscalation = uncertainPhrases.some(p => output.toLowerCase().includes(p));

    if (needsEscalation) {
      await ctx.emit({
        type: "agent.iteration",
        timestamp: Date.now(),
        runId: event.runId,
        payload: { escalation: true, reason: "low-confidence answer detected" },
      });
    }
  },
});

// Use in registry
const registry = defineRegistry({
  id: "support-agent",
  instructions: `You are a customer support agent.
If you cannot confidently answer, say "I'll connect you with a human agent."`,
  tools: [notionSearch, dbQuery],
  hooks: [escalationHook],
  defaultMode: directMode,
});
```

### Budget Control Guard (read-only state ref)

```typescript
let totalCost = 0;
const MAX_BUDGET = 100;

const budgetGuard = defineGuard({
  id: "budget-control",
  appliesTo: (meta) => meta.cost === "expensive" || meta.cost === "moderate",
  evaluate: () => {
    if (totalCost >= MAX_BUDGET) {
      return { veto: `Budget exhausted (${totalCost}/${MAX_BUDGET})` };
    }
    return "allow";
  },
});

// Track cost via hook (side effect = hook's job)
const costTrackingHook = defineHook({
  id: "cost-tracker",
  events: ["tool.after"],
  handler: async (event) => {
    totalCost += 1; // increment per tool call; real impl reads token usage
  },
});
```

## End-to-End: Tracing + Eval + Langfuse

Complete flow from agent run to Langfuse dashboard:

```typescript
import { createHarness, defineMode, defineRegistry } from "@harness/core";
import { defineModel } from "@harness/core";
import { runEval, type Evaluator } from "@harness/eval";

// 1. Create harness WITH Langfuse tracing
const harness = createHarness({
  registry,
  model: defineModel.openai({ model: "gpt-4o" }),
  observability: "langfuse",  // auto-traces all runs
});

// 2. Define evaluators
const relevance: Evaluator = ({ output, expectedOutput }) => ({
  name: "relevance",
  value: output.toLowerCase().includes((expectedOutput ?? "").toLowerCase()) ? 1 : 0,
});

// 3. Run eval — results go to Langfuse experiment (if credentials set)
const result = await runEval({
  name: "support-agent-v2",
  cases: [
    { input: "What's my order status?", expectedOutput: "shipped" },
    { input: "How do I return an item?", expectedOutput: "return policy" },
  ],
  task: async (input) => {
    const { text } = await harness.run(input);  // traced to Langfuse
    return text;                                  // scored in Langfuse
  },
  evaluators: [relevance],
  threshold: 0.8,
});

// 4. Check Langfuse dashboard:
//    - Traces tab: each harness.run() appears with tool calls + model generations
//    - Experiments tab: runEval results with per-case scores
//    - Compare experiments across agent versions
```

## LLM-as-Judge Evaluator

Use an LLM to evaluate quality when rule-based scoring isn't enough:

```typescript
import { generateText } from "ai";
import { defineModel } from "@harness/core";

const llmJudge: Evaluator = async ({ input, output, expectedOutput }) => {
  const judgeModel = defineModel.openai({ model: "gpt-4o-mini" });
  const { text: verdict } = await generateText({
    model: judgeModel,
    prompt: `Rate this agent response on a 0-10 scale.

Question: ${input}
Expected answer: ${expectedOutput ?? "N/A"}
Actual answer: ${output}

Respond with ONLY a JSON object: {"score": <0-10>, "reason": "<one sentence>"}`,
  });
  const parsed = JSON.parse(verdict);
  return {
    name: "llm-judge",
    value: parsed.score / 10,
    comment: parsed.reason,
  };
};
```

Note: LLM-as-judge evaluators are async and need an API key. Use them for Langfuse experiments, not CI (where offline rule-based evaluators are better).
