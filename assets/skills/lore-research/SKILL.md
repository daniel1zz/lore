---
name: lore-research
description: "Use when evaluating libraries, comparing SDKs, selecting tech stacks, benchmarking approaches, or exploring unfamiliar domains before implementation. Args: '<mode> [context]' — the FIRST token is the mode, one of: benchmark|exploration|pattern|sdk."
---

# Research — Skill

Self-executing skill. Reads mode protocol, dispatches generic agents, synthesizes results.
No named agent dependency — methodology lives in `references/`.

## Step 1: Mode Routing

Determine mode from argument `$0` or infer from context:

| Signal | Mode |
|--------|------|
| Named candidates + "which one" | **sdk** |
| Known problem category (auth / state / API) | **pattern** |
| Candidates known + need measured numbers | **benchmark** |
| Unknown problem space, want landscape | **exploration** |
| `sdk+benchmark` overlap | sdk first -> benchmark if top-2 within 10% |
| `pattern+exploration` overlap | pattern if domain familiar, exploration if not |

## Step 2: Check Existing Decisions

Before dispatching, check for prior research:
```
lore search "<topic>" --type adr --json -> look for existing ADRs on this topic
```
If found -> confirm with user before re-researching.

## Step 3: Dispatch

Read `references/protocol.md` for cross-cutting methodology (completion gate, evidence, tools).
Read `references/mode-{mode}.md` for mode-specific phases and role matrices.

### Mode: sdk / pattern / benchmark

Spawn **one** generic agent. It reads references internally and orchestrates sub-agents per mode protocol.

```
Agent({
  description: "Research: {mode} — {topic}",
  prompt: `
    You are a technical researcher. Your job: find, evaluate, recommend — never implement.

    ## Assignment
    Mode: {mode}
    Topic: {topic}
    Constraints: {extracted constraints}
    Project stack: {from package.json / codebase context}

    ## Instructions
    1. Read references/protocol.md (cross-cutting: tools, completion gate, evidence, output format)
    2. Read references/mode-{mode}.md (mode-specific: phases, role matrices, scoring)
    3. Follow the phases in the mode file. Use Sequential Thinking for evaluation.
    4. Apply completion gate before concluding.
    5. Return findings in the output format from protocol.md.

    ## Context
    Plan: {plan_id or "none"}
    Task: {task_id or "none"}

    ## Constraints
    - Do NOT write or edit any files. Research only.
    - Default BUY over BUILD.
    - Query official docs (context7/deepwiki) BEFORE community sources.
  `
})
```

### Mode: exploration

Exploration needs N independent directions explored simultaneously.

1. Identify 3-5 exploration directions from the topic
2. Read `references/mode-exploration.md` for the survey template
3. Spawn **N parallel agents** in a single message:

```
Agent({
  description: "Explore: {direction_1}",
  prompt: `
    You are exploring ONE technology direction as part of a broader landscape survey.
    Direction: {direction_1}
    Problem space: {problem description}
    Other directions being explored: {list}

    Read references/mode-exploration.md for your survey template.
    Use context7, deepwiki, WebSearch, GitHub tools. Verify claims via official docs.
    Return: structured findings in 400 words max.
  `
})
// ... repeat for each direction, ALL in one message for parallel execution
```

3. After all agents return, **YOU synthesize** the landscape:
   - Direction comparison table
   - Cross-cutting trade-offs
   - Preliminary recommendation
   - Follow-up research suggestions (with mode)

## Step 4: Post-Research

After agent(s) return:

1. **Relay findings** to the user (comparison table + recommendation + confidence)
2. **Persist decision** if applicable: `lore template show adr --blank > f.yaml` → fill (rationale, alternatives, tradeoffs) → `lore create adr --parent <spec it governs> --title "<title>" --decision-status proposed --fields-file f.yaml`
3. **Route downstream** if needed:
   - Research reveals architecture decision -> suggest `/design`
   - Research reveals implementation ready -> suggest `lore ready <plan> --json`
