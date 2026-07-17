# Research Mode: Exploration

**Purpose**: Multi-direction parallel technology landscape survey for open-ended problem spaces

## Phase 1: Scope Definition

1. Clarify exploration scope: what problem space? what constraints?
2. Identify 3-5 **exploration directions** (technology categories, approaches, or paradigms)
3. Output: **Exploration Brief** — problem space + directions to investigate

## Phase 2: Multi-Direction Parallel Survey (Variant B)

Launch **N parallel subagents** (one per exploration direction, typically 3-5).
Use `Agent` tool — send ALL in a single message for true parallel execution.

Unlike role-based parallelism, each agent explores a **different technology direction** independently.

### Subagent Prompt Template

Each subagent receives:

```
## Exploration Direction
**Direction {N}**: {specific technology category/approach/paradigm to explore}

## Context
**Problem Space**: {problem description}
**Constraints**: {known constraints}
**Other Directions Being Explored**: {list of other agents' directions — for awareness, not to overlap}

## Your Task
Survey this technology direction thoroughly. Use WebSearch, context7, GitHub, and deepwiki tools.

Provide:
1. **Key Players** (3-5): Major options in this direction, with maturity (emerging/stable/legacy)
2. **Per-Option Summary**: key characteristics, typical use cases, pros, cons, best_for, avoid_when
3. **Landscape Assessment**: Is this direction growing, stable, or declining? Why?
4. **Standout Option**: If you had to pick ONE from this direction, which and why?
5. **Cross-Direction Insight**: How does this direction compare to the others being explored? When would you choose this direction over alternatives?
6. **Knowledge Gaps**: What questions remain unanswered?

Verify claims via official docs (context7/deepwiki) for top 2-3 options. 400 words max.
```

## Phase 3: Landscape Synthesis

After all agents return, synthesize into unified landscape:

### Synthesis Framework

1. **Direction Comparison Table**:

| Direction | Maturity | Best For | Avoid When | Top Option | Confidence |
|-----------|----------|----------|------------|-----------|-----------|
| {dir 1} | ... | ... | ... | ... | H/M/L |

2. **Cross-Cutting Trade-offs**: complexity vs capability, vendor lock-in, team learning curve, cost
3. **Convergence Points**: where multiple directions overlap or complement each other
4. **Preliminary Recommendation**: best direction for this specific context
5. **Follow-up Roadmap**: suggested next research modes per direction:
   - Promising direction → `research sdk` or `research pattern`
   - Need quantitative comparison → `research benchmark`
   - Ready to choose → `design architecture`

## Phase 4: Follow-up (MANDATORY)

- Identify knowledge gaps across all directions
- Suggest specific follow-up modes with concrete queries
- Output: follow_up_questions with suggested_mode

## Cross-Cutting Protocol References
- **Completion Gate**: Apply `Research Completion Gate` from SKILL.md (exploration confidence floor = 60%, per SKILL.md).
- **Evidence**: Tag key findings per `Evidence Protocol` from SKILL.md during Phase 2
- **Bias**: Apply `Bias Mitigation` checklist — especially important for exploration to avoid only exploring familiar directions
- **Handoff**: Include `Handoff Contract` from SKILL.md — for exploration, `decision` field = recommended direction(s), not final choice

## Output
landscape_summary, direction_comparison_table, trade_off_matrix, follow_up_questions (with suggested_mode), preliminary_recommendation, **handoff** (per Handoff Contract)

## Tool Priority
1. WebSearch, context7 | 2. github | 3. gitmcp, mcp-deepwiki
