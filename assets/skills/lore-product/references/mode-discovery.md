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
2. **Evidence Tier**: Per finding, tag E1-E6 using the Evidence Ladder in [mode-validate.md](mode-validate.md)
   (E1 observed behavior · E2 money spent · E3 time invested · E4 past-behavior quotes · E5 public complaints · E6 stated intent).
   ⛔ An untagged finding is inadmissible. ⛔ A finding you could only produce from model recall is E6 — go verify it or drop it.
3. **Signal vs Noise**: Most important signal found? What looked important but isn't?
4. **Critical Question**: The ONE question that must be answered before proceeding
5. **Verdict**: green light / yellow flag / red flag — with 1-sentence reasoning

Keep output concise (400 words max). Cite sources with URLs. Be specific, not generic.
```

## Phase 3: Synthesis

After all 5 agents return, synthesize:

### Synthesis Framework

1. **Evidence Convergence** — findings corroborated by 3+ roles (highest confidence)
2. **Contradictions** — where roles disagree (investigate further or flag as risk)
3. **Existing Solution Landscape** — SaaS + OSS options discovered across all roles
4. **Problem Score (quantified — replaces subjective verdicts)**

   Score the core problem on four dimensions, 1-5 each, per the rubric in [mode-validate.md](mode-validate.md).
   ⛔ **Every score cites a finding and its evidence tier.** An uncited dimension is not scored "3 by default" — it is scored `unknown` and the gap is reported.

   **Score = Frequency × Intensity × Workarounds × WTP** → **≥250** proceed · **100-249** close the weakest dimension first · **<100** reframe or walk away.

   Multiplicative on purpose: an additive average lets a strong market story bury the fact that nobody has ever tried to solve the problem themselves.

5. **Market Reality Score** (aggregate, secondary to the Problem Score):
   - Market attractiveness (Market Analyst + Business Model)
   - Competitive defensibility (Competitive Intelligence)
   - Risk profile (Risk Assessor)
6. **Unvalidated Assumptions** — ranked by impact x cost-to-validate
7. **Validation Roadmap** — ordered experiments, cheapest/fastest first, each with its **kill condition stated up front**

⛔ The roadmap is a commitment to run experiments, not a deliverable in itself. It is executed in `/lore-product validate` — see the flow constraint below.

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
- **Go → Opportunity** (`/lore-product opportunity`) — Problem Score ≥250 with cited evidence; derive the feature set from the outcome via an OST
- **Validate first** (`/lore-product validate`) — Problem Score 100-249, or the score rests on E5/E6 evidence; run the cheapest disproving experiments before committing
- **Pivot** — core idea has issues but adjacent opportunity identified
- **No-go** — Problem Score <100 or multiple red flags; recommend parking or killing

⛔ **"Go → PRD" is not an option here.** Discovery establishes that a problem is worth solving; it does not establish *what to build*. Routing discovery directly into a PRD is what produces feature lists invented by the author — the failure this chain exists to prevent.

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

📎 Actually talking to users — question wording, the 30-minute script, the commitment-currency ask, and what is legitimately substitutable when real users are unreachable: [interview-protocol.md](interview-protocol.md).

## Exit Criteria

Discovery is complete when:
- [ ] All 5 role analyses returned and synthesized
- [ ] Every finding carries an E1-E6 evidence tier with a source
- [ ] **Problem Score computed** (F × I × W × P), each dimension citing a tiered finding; `unknown` dimensions reported, not defaulted
- [ ] Market Reality Score computed
- [ ] Adopt-First Gate evaluated (existing solutions assessed)
- [ ] Unvalidated assumptions ranked; each validation-roadmap item has a kill condition
- [ ] Cross-cutting concerns checklist passed
- [ ] Output persisted in the lore corpus with upstream links
- [ ] Clear recommendation provided: Opportunity / Validate / Pivot / No-go

## Persist Output
- Artifact: `lore create knowledge --sub-type research --title '{topic} Discovery' --content ...`
- Link to upstream ideation doc if exists: `lore link <discovery> <ideation-doc> --type=implements`

## Triggers
"Validate this idea", "Research the market", "Who are our competitors", "Is there demand for...", "What solutions already exist"
