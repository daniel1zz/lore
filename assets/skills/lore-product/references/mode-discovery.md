# Mode: Discovery

**Purpose**: Multi-role parallel market validation with strategic rigor

## Phase 1: Context Intake

1. Collect from user or upstream ideation output:
   - Product idea / concept
   - Target user hypothesis
   - Known constraints (budget, timeline, team)
2. Distill a **discovery brief** (1 paragraph): what we're validating, for whom, and why now

## Phase 2: Multi-Role Parallel Market Validation

Launch **5 parallel subagents**, each investigating the opportunity from a distinct lens.
Use `Agent` tool — send ALL 5 in a single message for true parallel execution.

### Role Matrix

| # | Role | Identity Prompt | Core Investigation |
|---|------|----------------|-------------------|
| 1 | **Market Analyst** | "You are a market research analyst with access to public data. Be quantitative and skeptical of inflated TAM." | Realistic TAM/SAM/SOM? Growth trends? Market timing? Regulatory risks? Who are the hidden players? |
| 2 | **Target User Proxy** | "You are the ideal end user. Think from your daily workflow, pain tolerance, and switching costs." | Current workaround? Willingness to pay? What would make you try this? What would make you churn? Rate on User Validation Hierarchy (paying > workaround > frustration > interest > opinion) |
| 3 | **Competitive Intelligence** | "You are a competitive analyst. Find what others miss — including non-obvious competitors." | Direct competitors? Indirect substitutes? OSS alternatives? Adjacent products expanding? Big tech entry risk? Distribution/data/network moats? What would it cost incumbents to copy us? |
| 4 | **Business Model Analyst** | "You are a business strategist focused on unit economics and go-to-market." | Revenue model options? Unit economics? CAC vs LTV? Distribution strategy? Pricing power? Growth flywheel? Venture-scale or lifestyle business? |
| 5 | **Risk Assessor** | "You are a risk analyst whose job is to find failure modes the team hasn't considered." | Top 5 risks (market, tech, execution, regulatory, timing)? Unvalidated assumptions? Red flags: well-funded incumbents, low WTP, high CAC, winner-take-all? What would the post-mortem say? |

### Subagent Prompt Template

Each subagent receives:

```
## Role
{Identity Prompt}

## Discovery Brief
{1-paragraph brief from Phase 1}

## Your Task
Use WebSearch and available research tools to investigate this opportunity from your perspective.

Provide:
1. **Key Findings** (3-5): Specific data points, names, numbers. Not generic observations.
2. **Evidence Quality**: Per finding — Strong (data-backed) / Moderate (multiple sources) / Weak (inference)
3. **Signal vs Noise**: Most important signal found? What looked important but isn't?
4. **Critical Question**: The ONE question that must be answered before proceeding
5. **Verdict**: green light / yellow flag / red flag — with 1-sentence reasoning

Keep output concise (400 words max). Cite sources. Be specific, not generic.
```

## Phase 3: Synthesis

After all 5 agents return, synthesize:

### Synthesis Framework

1. **Evidence Convergence** — findings corroborated by 3+ roles (highest confidence)
2. **Contradictions** — where roles disagree (investigate further or flag as risk)
3. **Existing Solution Landscape** — SaaS + OSS options discovered across all roles
4. **Market Reality Score** (aggregate):
   - Market attractiveness (Market Analyst + Business Model)
   - User pain intensity (Target User Proxy)
   - Competitive defensibility (Competitive Intelligence)
   - Risk profile (Risk Assessor)
5. **Unvalidated Assumptions** — ranked by impact x cost-to-validate
6. **Validation Roadmap** — ordered experiments, cheapest/fastest first

### Verdict Summary Table

| Role | Verdict | Top Finding | Critical Question |
|------|---------|-------------|-------------------|
| Market Analyst | ... | ... | ... |
| Target User Proxy | ... | ... | ... |
| Competitive Intel | ... | ... | ... |
| Business Model | ... | ... | ... |
| Risk Assessor | ... | ... | ... |

### Adopt-First Gate
If mature existing solutions found → recommend adoption over building. Hard gate per Research-First principle.

## Phase 4: Recommendation

Based on synthesis, output one of:
- **Go → PRD** (`/lore-product prd`) — strong signal across roles, risks manageable
- **Validate first** — specific experiments needed before committing (list them)
- **Pivot** — core idea has issues but adjacent opportunity identified
- **No-go** — multiple red flags, recommend parking or killing

## JTBD Integration (RECOMMENDED)

When user pain data is available, apply JTBD framework (see [jtbd-framework.md](jtbd-framework.md)):
- Use **switch interview data** to validate push/pull forces
- Map findings to **outcome statements** for quantifiable pain measurement
- Competing solutions = anything users hire for the same job (not just same category)

## Cross-Cutting Concerns Gate (MANDATORY)

Before finalizing discovery output, verify:
- [ ] Privacy impact: Does the opportunity require sensitive data? Is the privacy cost justified?
- [ ] Ethical risk: Could this product/feature be used harmfully at scale?
- [ ] Inclusivity: Who is excluded from the target market and why? Is that acceptable?
- [ ] Sustainability: Environmental/digital wellbeing concerns identified?

See [cross-cutting-concerns.md](cross-cutting-concerns.md) for full framework.

## Market Red Flags (reference)
Well-funded incumbents, low willingness to pay, high CAC, winner-take-all favoring leaders, regulatory complexity

## Interview Anti-Patterns (reference)
Leading questions, asking about future behavior ("would you use X?"), pitching during discovery, only talking to fans

## Exit Criteria

Discovery is complete when:
- [ ] All 5 role analyses returned and synthesized
- [ ] Market Reality Score computed with evidence quality ratings
- [ ] Adopt-First Gate evaluated (existing solutions assessed)
- [ ] Unvalidated assumptions ranked and validation plan created
- [ ] Cross-cutting concerns checklist passed
- [ ] Output persisted in the lore corpus with upstream links
- [ ] Clear recommendation provided: Go / Validate / Pivot / No-go

## Persist Output
- Artifact: `lore create knowledge --sub-type research --title '{topic} Discovery' --content ...`
- Link to upstream ideation doc if exists: `lore link <discovery> <ideation-doc> --type=implements`

## Triggers
"Validate this idea", "Research the market", "Who are our competitors", "Is there demand for...", "What solutions already exist"
