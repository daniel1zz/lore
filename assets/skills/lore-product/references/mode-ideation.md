# Mode: Ideation

**Purpose**: Multi-role parallel brainstorming for divergent, comprehensive idea generation — grounded in what the market already shipped, and converging on a derived feature set rather than a wish list.

## Phase 0: Benchmark Grounding Gate (HARD — before any brainstorm)

⛔ **REFUSE to run the role brainstorm from a blank slate.** Role agents reasoning without a benchmark produce a plausible average of the category — generic ideas that feel insightful and are untethered to what ships today.

Required before Phase 2, unless the user explicitly waives it:

1. Run `lore-product-benchmark` (or `lore search "{category} benchmark" --json` if a teardown ≤2 quarters old already exists) to obtain a **Feature Matrix** — table-stakes / differentiator / trap / gap rows, each with a source URL.
2. Pass the matrix to every role agent as shared context.

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "I know this category well, a teardown is overkill" | Model recall is a blurry average of everything read, not today's shipped reality. It is E6-grade at best. |
> | "The user described the product clearly, so I have enough" | Their description says what they want; the matrix says what users already have and will compare against. |

Waived by the user → record it, and tag the resulting ideas `⚠️ ungrounded` so downstream modes know the feature set never met the market.

## Phase 1: Context Intake

1. **Acknowledge** the vision
2. **Probe** (brief): What triggered this? Who has this problem? Any constraints?
3. Distill a **1-paragraph brief** summarizing the idea, target user, and known constraints
   - This brief plus the Feature Matrix is the shared input for all role agents

## Phase 2: Multi-Role Parallel Brainstorm

Launch **6 parallel subagents**, each with a distinct role identity and evaluation lens.
Use `Agent` tool — send ALL 6 in a single message for true parallel execution.

### Role Matrix

| # | Role | Identity Prompt | Core Questions |
|---|------|----------------|----------------|
| 1 | **Target User** | "You are the ideal end user of this product. Think from your daily pain points, habits, and emotions." | Why would I use this? What's my current workaround? What would make me switch? What would make me quit? |
| 2 | **Business Strategist** | "You are a business strategist evaluating market opportunities." | Market size? Revenue model? Competitive moat? Unit economics? Growth flywheel? |
| 3 | **Tech Architect** | "You are a senior technical architect assessing feasibility." | Core technical risks? MVP minimum path? Build vs buy? Scalability bottleneck? Key technical assumptions? |
| 4 | **UX Designer** | "You are a UX designer focused on user journey and interaction." | First-time experience? Key interaction moments? Friction points? What does "delight" look like? Accessibility? |
| 5 | **Devil's Advocate** | "You are a skeptic whose job is to find fatal flaws. Be brutally honest." | Why will this fail? Biggest unvalidated assumption? What if the market is smaller than expected? Who tried this before and failed? |
| 6 | **Investor** | "You are a VC partner evaluating this as a potential investment." | Is this venture-scale? What's the defensibility? Team-market fit? When does this hit product-market fit? What's the kill metric? |

### Subagent Prompt Template

Each subagent receives:

```
## Role
{Identity Prompt}

## Product Brief
{1-paragraph brief from Phase 1}

## Your Task
From your role's perspective, provide:
1. **Opportunities** (3-5): What excites you about this idea?
2. **Concerns** (3-5): What worries you? What could go wrong?
3. **Suggestions** (3-5): How would you improve or pivot the idea?
4. **Critical Question**: The ONE question that must be answered before proceeding
5. **Verdict**: excited / cautiously optimistic / skeptical / opposed — with 1-sentence reasoning

Keep output concise (300 words max). Be bold and specific, not generic.
```

## Phase 3: Synthesis

After all 6 agents return, synthesize into a structured report:

### Synthesis Framework

1. **Consensus Signals** — ideas/concerns that 3+ roles agree on (high confidence)
2. **Creative Tensions** — where roles disagree (most valuable insights live here)
3. **Blind Spots Revealed** — concerns raised by only 1 role that others missed
4. **Top Opportunities** — ranked by cross-role enthusiasm (weighted: User > Business > others)
5. **Kill Risks** — issues flagged as potential deal-breakers by any role
6. **Validation Roadmap** — ordered list of assumptions to test, cheapest/fastest first
7. **Refined Idea Statement** — 1-paragraph evolved version incorporating the best insights

### Verdict Summary Table

| Role | Verdict | Top Concern | Top Opportunity |
|------|---------|-------------|-----------------|
| Target User | ... | ... | ... |
| Business Strategist | ... | ... | ... |
| Tech Architect | ... | ... | ... |
| UX Designer | ... | ... | ... |
| Devil's Advocate | ... | ... | ... |
| Investor | ... | ... | ... |

## Phase 4: Convergence Gate (HARD — brainstorm output is not a feature list)

⛔ **Ideation MUST NOT hand a feature list to PRD.** Six roles produce opportunities, concerns, and suggestions — divergent material. Treating that pile as scope is how a product ends up as whatever the loudest role said.

Before exiting, convert the divergent output into structured input for the next stage:

| Brainstorm artifact | Converts to | Destination |
|--------------------|-------------|-------------|
| Cross-role opportunities + benchmark `gap` rows | Candidate **opportunities** (customer needs, not features) | `/lore-product opportunity` — the OST derives solutions |
| Kill Risks + unvalidated assumptions | Hypotheses with kill conditions | `/lore-product validate` |
| Market/competitive concerns | Discovery brief | `/lore-product discovery` |

Restate each candidate opportunity as a **user need, not a product noun** — apply the solution-in-disguise detector in [mode-opportunity.md](mode-opportunity.md). "Add a template gallery" is not an opportunity; "starting from empty is intimidating and people stall" is.

## Phase 5: Next Steps

Based on synthesis, recommend one of:
- **Proceed to Opportunity** (`/lore-product opportunity`) — enough signal and evidence to derive the feature set from an outcome
- **Proceed to Discovery** (`/lore-product discovery`) — market/competitive reality still unknown, validate before deriving scope
- **Pivot & Re-brainstorm** — fundamental issues found, re-run with adjusted brief
- **Park** — timing/market/feasibility issues, save for future re-evaluation
- **Kill** — fatal flaws identified, not worth pursuing

⛔ **Never recommend jumping straight to PRD from ideation.** Nothing has been derived or validated yet; a PRD written here is a transcript of the brainstorm.

## Configuration

Users can customize the brainstorm:
- **Add roles**: "also include a regulatory expert" → adds 7th agent
- **Remove roles**: "skip investor perspective" → run with 5 agents
- **Focus**: "focus on B2B SaaS" → adjusts all role prompts with domain context
- **Deep dive**: "go deeper on the tech architect's concerns" → re-run single agent with expanded scope

## Triggers
"I have an idea", "Brainstorm solutions", "What if we...", "New product concept",
"Help me think through", "Evaluate this idea", "Product brainstorm"
