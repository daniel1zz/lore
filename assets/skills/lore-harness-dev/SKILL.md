---
name: lore-harness-dev
description: "Guide development of AI agents using the harness-agent framework. Use when: building a new agent, creating tools, setting up registries, configuring guards/modes/memory, writing evals, or deploying as MCP/HTTP server. Triggers on: 'create an agent', 'new harness', 'add a tool', 'set up eval', 'configure tracing', 'deploy agent', 'harness template', 'defineTool', 'defineRegistry', 'createHarness', 'agent registry', 'tool metadata', 'guard configuration', 'Langfuse eval', or any request involving building/extending agents on top of @harness/core. Also use when the user mentions vertical agents, agent templates, safety guards, execution modes, or agent memory layers."
---

# harness-dev — Agent Development Guide

You are guiding a developer through the harness-agent framework. This framework lets you declare AI agents with typed tools, safety guards, execution modes, and memory — then bootstrap them via `createHarness`.

## Core Mental Model

```
defineTool → defineHook → defineGuard → defineMode → defineRegistry → createHarness → harness.run()
```

Everything is **declarative and immutable**. One Registry = one Agent role. No mutation, no glue code.

## Decision Tree: What Are You Building?

Ask the user which path they're on:

| Situation | Path |
|---|---|
| "I want a new vertical agent (legal, support, etc.)" | Fork a template → customize SLOTS |
| "I want a custom agent from scratch" | defineTool → defineRegistry → createHarness |
| "I want to add tools to an existing registry" | defineTool + metadata → add to registry |
| "I want to set up eval for my agent" | @harness/eval + cases.ts |
| "I want observability/tracing" | Langfuse integration |
| "I want to deploy my agent" | MCP server or HTTP server |

## Path 1: Fork a Template

Templates live in `templates/<name>-agent/`. Each has exactly 3 editable SLOTS:

```bash
cp -r templates/code-reviewer-agent templates/my-agent
```

Edit `src/main.ts` — only modify lines marked `// AI:SLOT business-*`. Infrastructure lines (`// AI:LOCKED`) are off-limits.

Read `references/templates.md` for the full SLOTS protocol and available templates.

## Path 2: Build from Scratch

### Step 1: Define Tools

Every tool needs 6-dimensional metadata for guard admission:

```typescript
import { defineTool } from "@harness/core";
import { z } from "zod";

const myTool = defineTool({
  id: "my-domain.action",
  description: "What this tool does",
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  metadata: {
    category: "network",      // ui | filesystem | network | shell | data | compute | agent
    access: "read",           // read | write | read-write
    danger: "low",            // safe | low | medium | high
    reversibility: "reversible", // reversible | soft-irreversible | irreversible
    idempotency: "idempotent",   // idempotent | non-idempotent
    cost: "cheap",            // free | cheap | moderate | expensive
    cloudSafe: true,
    tags: [],
  },
  execute: async (input) => {
    // implementation
    return { result: "done" };
  },
});
```

**Critical**: If you omit `metadata`, the framework defaults to most-restrictive (danger=high, cloudSafe=false). Your tool will be blocked by guards in strict/standard mode. Always declare metadata explicitly.

Read `references/tool-metadata.md` for the dimension decision guide.

### Step 2: Define Registry

```typescript
import { defineMode, defineRegistry } from "@harness/core";

const directMode = defineMode({
  id: "direct",
  config: { kind: "direct", maxIterations: 8 },
});

const registry = defineRegistry({
  id: "my-agent",
  instructions: "You are a ... agent. Your job is to ...",
  tools: [myTool, anotherTool],
  guards: [],        // optional: custom guards
  hooks: [],         // optional: lifecycle hooks
  defaultMode: directMode,
  memory: undefined, // optional: defineMemory(...)
});
```

### Step 3: Create Harness

```typescript
import { createHarness } from "@harness/core";
import { defineModel } from "@harness/core";

const model = defineModel.openai({ model: "gpt-4o" });

const harness = createHarness({
  registry,
  model,
  safeMode: "standard",        // strict | standard | permissive
  observability: "langfuse",   // optional: enables Langfuse tracing
});

const result = await harness.run("Your prompt here");
console.log(result.text);
```

### Step 4: Choose safeMode

| Mode | Network | FS Write | High-Danger | Use When |
|------|---------|----------|-------------|----------|
| `strict` | Blocked | Blocked | Blocked | Untrusted/sandboxed environments |
| `standard` | Allowed | Blocked | Blocked | Production agents needing API access |
| `permissive` | Allowed | Allowed | Allowed | You manage your own guard stack |

## Path 3: Set Up Eval

```typescript
import { runEval, type Evaluator } from "@harness/eval";

const accuracy: Evaluator = ({ output, expectedOutput }) => ({
  name: "accuracy",
  value: output.includes(expectedOutput ?? "") ? 1 : 0,
});

const result = await runEval({
  name: "my-agent-eval",
  cases: [
    { input: "What is 2+2?", expectedOutput: "4" },
  ],
  task: async (input) => {
    const { text } = await harness.run(input);
    return text;
  },
  evaluators: [accuracy],
  threshold: 0.7,
});
```

- With `LANGFUSE_PUBLIC_KEY` set: results persist to Langfuse (experiments, scoring, comparison)
- Without: runs offline with same result shape (CI-friendly)

## Path 4: Langfuse Tracing

Set env vars:
```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com  # optional
```

Then pass `observability: 'langfuse'` to `createHarness`. All agent runs, tool calls, and model generations auto-trace.

## Path 5: Deploy

### As MCP Server
```typescript
const server = await harness.asMcpServer({ name: "my-agent" });
await server.start();
```

### As HTTP Server
```typescript
import { createHarnessServer } from "@harness/server";
const app = createHarnessServer(harness);
app.listen(3000);
```

## Mode System (7 kinds, closed set)

| Kind | When to Use |
|------|-------------|
| `direct` | Simple Q&A, single-pass |
| `react` | Tool-use loops (ReAct pattern) |
| `reflect` | Self-critique + revision cycles |
| `plan-execute` | Complex multi-step with planning |
| `tot` | Ensemble voting across parallel paths |
| `debate` | Multi-perspective dialectic |
| `mcts` | Weighted tree search with backprop |

## Memory Layers

| Layer | What | How |
|---|---|---|
| L0 Profile | Identity facts | `defineMemory({ profile: { name, role, facts } })` |
| L1 Preferences | Behavioral rules | `defineMemory({ preferences: { languages, coding_style, do_not } })` |
| L2 Project | Project context | `defineMemory({ project: { name, description, constraints } })` |
| L3 Session | Conversation thread | `harness.run(prompt, { threadId: "..." })` |
| L4 Semantic | Cross-session recall | `memory: { semantic: { enabled: true, topK: 3 } }` |
| L5 Procedural | Learned rules | `memory: { procedural: new LibSqlProceduralStore({ url }) }` |

## Guards (custom)

```typescript
import { defineGuard } from "@harness/core";

const budgetGuard = defineGuard({
  id: "budget-limit",
  appliesTo: (meta) => meta.cost === "expensive",
  evaluate: (ctx) => {
    if (spent > MAX_BUDGET) return { veto: "Budget exceeded" };
    return "allow";
  },
});
```

Guards answer "may this run?" — pure admission control. They can hold read-only state refs (e.g., budget tracker) but must not produce side effects.

## Advanced Topics

For multi-tool orchestration, external API integration, escalation hooks, budget guards, LLM-as-judge evaluators, or end-to-end tracing+eval flows, read `references/advanced-patterns.md`. It covers:

- **Tool chaining**: How the LLM orchestrates multiple tools via instructions + react mode
- **External API tools**: Notion KB, database query, HTTP POST templates with correct metadata
- **Escalation hook**: Detect low-confidence answers, trigger human handoff
- **Budget guard**: Read-only state ref pattern for cost control
- **End-to-end Langfuse flow**: harness.run() (traced) → runEval() (scored) → dashboard
- **LLM-as-judge**: Async evaluator using GPT-4o-mini as quality scorer

## References

- `references/tool-metadata.md` — 6-dimension decision guide with examples
- `references/templates.md` — Template SLOTS protocol + fork SOP
- `references/eval-patterns.md` — Evaluator patterns + Langfuse experiment tips
- `references/advanced-patterns.md` — Multi-tool orchestration, external API, hooks, LLM judge
