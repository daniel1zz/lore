# Research Mode: Pattern

**Purpose**: Multi-perspective architectural pattern evaluation

## Phase 1: Discovery (Doc-First)

Identify 3-5 candidate patterns using available tools:
- context7: official framework recommended patterns
- gitmcp: real implementations in well-known repos
- mcp-deepwiki: architecture understanding
- github: starter templates `stars:>1000`
- WebSearch: community articles (last resort)
- ALWAYS check official framework docs BEFORE community

Output: **Pattern Brief** — list of candidates with 1-sentence description each.

## Phase 2: Multi-Perspective Pattern Evaluation

Launch **5 parallel subagents**, each evaluating ALL candidate patterns from a specialized lens.
Use `Agent` tool — send ALL 5 in a single message for true parallel execution.

### Perspective Matrix

| # | Perspective | Identity Prompt | Evaluation Focus |
|---|------------|----------------|-----------------|
| 1 | **Scalability Engineer** | "You evaluate how well this pattern scales — data growth, traffic spikes, team growth." | Horizontal scaling? State management at scale? Performance ceiling? Data partitioning? When does this pattern break? |
| 2 | **Complexity Analyst** | "You evaluate cognitive complexity and learning curve. Simpler is better unless complexity buys something critical." | Conceptual overhead? How many concepts to learn? Indirection layers? Debugging difficulty? Onboarding time for new devs? |
| 3 | **Ecosystem Expert** | "You evaluate ecosystem fit — libraries, community, tooling, migration paths." | Library support? Community adoption? Tooling quality? Migration path from current architecture? Ecosystem trajectory (growing/stable/declining)? |
| 4 | **Team Fit Assessor** | "You evaluate team readiness and practical adoption. Think about the actual dev team." | Team's existing skills? Learning investment? How much existing code needs changing? Risk of half-adoption? Can team maintain this in 2 years? |
| 5 | **Testability Reviewer** | "You evaluate how testable code written in this pattern is." | Unit testable? Integration testable? Mock boundaries clear? Test isolation? Debugging experience? Observable behavior? |

### Subagent Prompt Template

Each subagent receives:

```
## Evaluation Perspective
{Identity Prompt}

## Pattern Brief
**Challenge**: {technical challenge being solved}
**Candidates**: {list of 3-5 patterns with descriptions}
**Current Architecture**: {existing patterns in codebase}
**Stack**: {framework, runtime, key dependencies}

## Your Task
Evaluate each candidate pattern from your specialized perspective. Use context7, deepwiki, and GitHub tools for evidence.

Provide:
1. **Per-Pattern Scores** (1-10 with justification for your criterion)
2. **Recommendation**: Which pattern wins from YOUR perspective? Why?
3. **Deal-Breakers**: Any pattern that should be eliminated? Why?
4. **Migration Risk**: How hard is adoption from current state?

Output as comparison table + brief analysis. 300 words max.
```

## Phase 3: Synthesis & Recommendation

After all 5 agents return, synthesize with weighted scoring:

```yaml
criteria:
  scalability:   { weight: 25%, source: "Scalability Engineer" }
  complexity:    { weight: 20%, source: "Complexity Analyst" }
  ecosystem:     { weight: 20%, source: "Ecosystem Expert" }
  team_fit:      { weight: 20%, source: "Team Fit Assessor" }
  testability:   { weight: 15%, source: "Testability Reviewer" }
```

### Synthesis Output

| Pattern | Scalability | Complexity | Ecosystem | Team Fit | Testability | **Weighted** |
|---------|-----------|-----------|-----------|---------|------------|-------------|
| A | ... | ... | ... | ... | ... | **X** |
| B | ... | ... | ... | ... | ... | **Y** |

## Phase 4: Post-Selection Docs Lookup (MANDATORY)

Query official integration docs for recommended pattern with project's stack.

## Cross-Cutting Protocol References
- **Completion Gate**: Apply `Research Completion Gate` from SKILL.md before concluding
- **Evidence**: Tag key findings per `Evidence Protocol` from SKILL.md during Phases 1-3
- **Bias**: Apply `Bias Mitigation` checklist from SKILL.md during Phase 1
- **Handoff**: Include `Handoff Contract` from SKILL.md in output

## Output
patterns_found, recommendation, confidence (0-100), rationale, comparison_table, implementation_sketch, migration_notes, **handoff** (per Handoff Contract)

## Tool Priority
1. context7, gitmcp | 2. mcp-deepwiki, github | 3. WebSearch
