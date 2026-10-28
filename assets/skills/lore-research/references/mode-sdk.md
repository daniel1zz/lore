# Research Mode: SDK

## Scope

Find and evaluate SDKs, libraries, and packages for a given technical need.
Multi-role parallel evaluation to prevent "first good result" bias.

## Input

```yaml
input:
  topic: "JWT authentication for Node.js"
  constraints: [TypeScript, Express compatible, active maintenance]
  max_candidates: 5  # optional, default 5
```

## Phase 0: Build vs Buy Check (MANDATORY)
```yaml
decision:
  default: "USE existing mature library (BUY)"
  build_only_when:
    - No mature option exists (< 1k stars, unmaintained, no TS support)
    - Requirement is trivially simple (< 50 lines, no edge cases)
    - Existing options have unacceptable trade-offs (license, bundle size, security)
  action: "If BUILD → document why no existing library fits. If BUY → proceed to Phase 1."
```

## Phase 1: Discovery (Doc-First + Debiased)

Identify top 3-5 candidates using available tools:
```yaml
actions:
  - context7.resolve-library-id: Identify top candidates from official docs
  - context7.query-docs: Check each candidate's official API, TS support, version status
  - github.search_repositories: "[topic] language:[lang] stars:>500"
  - gitmcp.search_generic_code: Find real-world usage patterns
  - WebSearch: "best [topic] libraries [year]"
```
⚠️ Do NOT shortlist candidates without querying their official docs first.

### Debiasing Gate (MANDATORY)
After initial candidate list, verify:
- [ ] At least 1 candidate with <5k stars included (if functional requirements met)
- [ ] Not all candidates from the same ecosystem/org
- [ ] Checked for declining-but-once-popular alternatives (survivorship bias)
- [ ] Discovery used ≥2 different tool types (not just GitHub stars)

## Phase 2: Multi-Role Parallel Evaluation

⚠️ **Escalation gate** — skip Phase 2 entirely when SKILL.md Reasoning Engine fast-path applies (framework has canonical SDK, no disqualifying constraint). Go straight to Phase 4. Only run Phase 2 when ≥3 serious candidates survive Phase 1 with non-obvious trade-offs.

Launch **5 parallel subagents** via `Agent` tool in a single message. Each agent = one lens, evaluates ALL candidates.

### Role Matrix (anchors — full evaluation criteria derivable from role name)

| # | Role | Evaluation Focus |
|---|------|-----------------|
| 1 | **DX Advocate** | API ergonomics, TS support depth, docs quality, error messages, time-to-productive |
| 2 | **Performance Engineer** | Bundle size, runtime overhead, memory, published benchmarks, cold start, scale |
| 3 | **Security Auditor** | CVEs, dep tree / attack surface, disclosure process, license, bus factor |
| 4 | **Maintenance Forecaster** (2-3yr horizon) | Release cadence, breaking-change history, governance, corporate backing, abandonment risk |
| 5 | **Integration Specialist** | Framework/runtime compat, existing-codebase patterns, migration effort, peer-dep conflicts |

### Subagent Prompt Template

Each subagent receives:

```
## Role
{Identity Prompt}

## SDK Selection Brief
**Need**: {topic}
**Constraints**: {constraints}
**Candidates**: {list of 3-5 candidates from Phase 1}
**Project Stack**: {framework, runtime, key dependencies}

## Your Task
Evaluate each candidate from your specialized perspective. Use context7, deepwiki, WebSearch, and GitHub tools.

Provide:
1. **Per-Candidate Scores** (1-10 scale for your criterion, with justification)
2. **Recommendation**: Which candidate wins from YOUR perspective? Why?
3. **Deal-Breakers**: Any candidate that should be eliminated? Why?
4. **Hidden Risk**: What risk might other evaluators miss from your lens?
5. **Integration Note**: One practical thing the team should know

Output as a comparison table + brief analysis. 300 words max.
```

## Phase 3: Synthesis & Scoring

After all 5 agents return, synthesize into weighted comparison:

```yaml
criteria:
  dx:           { weight: 20%, source: "DX Advocate" }
  performance:  { weight: 20%, source: "Performance Engineer" }
  security:     { weight: 20%, source: "Security Auditor" }
  maintenance:  { weight: 20%, source: "Maintenance Forecaster" }
  fit:          { weight: 20%, source: "Integration Specialist" }
```

### Synthesis Framework

1. **Consensus Pick** — candidate that ranks high across 4+ roles
2. **Controversial Candidates** — high variance across roles (investigate why)
3. **Eliminated Candidates** — deal-breakers from any role (with reasoning)
4. **Final Recommendation** — weighted score + qualitative judgment
5. **Risk Disclosure** — what could go wrong with the recommended choice

### Verdict Summary Table

| Criterion | Candidate A | Candidate B | Candidate C |
|-----------|------------|------------|------------|
| DX (20%) | ... | ... | ... |
| Performance (20%) | ... | ... | ... |
| Security (20%) | ... | ... | ... |
| Maintenance (20%) | ... | ... | ... |
| Fit (20%) | ... | ... | ... |
| **Weighted Total** | **X** | **Y** | **Z** |

## Phase 4: Post-Selection Docs Lookup (MANDATORY)

Query official integration docs for the recommended library paired with the project's stack (framework, runtime, peer deps). Extract: install steps, minimum version matrix, known compat caveats, migration notes if replacing an existing library. Tools: `context7.query-docs` (primary), `mcp-deepwiki.ask_question` (architecture detail), `WebSearch` (recent breaking changes only).

## Phase 5: Persist Decision (MANDATORY)

Use `lore create adr --parent <spec it governs>` to persist the architectural decision:

```
lore create adr --parent <spec it governs> \
  --title "Use {SDK} for {purpose}" \
  --decision-status proposed \
  --content "{context + evaluation summary + why this SDK won + alternatives considered with rejection reasons + constraints: must use {SDK} >= v{X}; avoid {rejected SDK} due to {deal-breaker}}"
```

Include in rationale: evaluation scores, role perspectives summary, alternatives considered with rejection reasons.

## Cross-Cutting Protocol References
- **Completion Gate**: Apply `Research Completion Gate` from SKILL.md before Phase 5
- **Evidence**: Tag key findings per `Evidence Protocol` from SKILL.md during Phases 1-3
- **Bias**: Apply `Bias Mitigation` checklist from SKILL.md during Phase 1
- **Handoff**: Include `Handoff Contract` from SKILL.md in Phase 5 output

## Tools (mode-specific priority)

| Tool | Priority | Use For |
|------|----------|---------|
| context7 | 1 | Official docs, API details, version status |
| github.search_repositories | 1 | Discovery, health metrics |
| gitmcp | 2 | Real implementation patterns |
| mcp-deepwiki | 2 | Architecture understanding of candidate repos |
| WebSearch | 3 | Community sentiment, benchmarks |
