# Impact Mapping

> Strategy-to-feature traceability. Ensures every deliverable connects to a business goal through a clear chain: Goal → Actors → Impacts → Deliverables.

## Why Impact Mapping

Most roadmaps suffer from **feature disconnect**: features are built because someone asked for them, not because they trace to a business outcome. Impact Mapping forces the question: "How does this deliverable create the impact we need, on the actors who matter, to reach our goal?"

## The 4 Levels

```
GOAL ─── WHY? ───────────────────────────────────────────────┐
  │                                                           │
  ├── ACTOR ─── WHO? ─────────────────────────────────┐       │
  │     │                                              │       │
  │     ├── IMPACT ─── HOW? ──────────────────┐        │       │
  │     │     │                                │        │       │
  │     │     ├── DELIVERABLE ─── WHAT? ───┐   │        │       │
  │     │     │                             │   │        │       │
  │     │     └─────────────────────────────┘   │        │       │
  │     └───────────────────────────────────────┘        │       │
  └──────────────────────────────────────────────────────┘       │
                                                                 │
  Traceability: every WHAT traces back to WHY                    │
```

### Level 1: GOAL (Why?)
- Business objective, SMART format
- Example: "Increase monthly recurring revenue by 20% in Q3"
- Must be measurable, time-bound, and owned
- Source: company OKRs, strategy documents

### Level 2: ACTORS (Who?)
- People or systems whose behavior must change to reach the goal
- Categories: **primary users**, **secondary users**, **internal actors**, **external systems**
- Example: "Free-tier users (convert to paid)", "Enterprise admins (expand seat count)", "Sales team (reduce demo-to-close cycle)"
- Include negative actors: "Competitors (whose users we want to attract)"

### Level 3: IMPACTS (How?)
- Behavior changes we want to create or support in each actor
- Format: "{Actor} should {behavior change}" — always a verb
- Example: "Free-tier users should hit the usage ceiling that motivates upgrade"
- **Anti-pattern**: Impacts that describe OUR actions, not ACTOR behavior changes

### Level 4: DELIVERABLES (What?)
- Features, experiments, or campaigns that create the desired impact
- These are **hypotheses** — we believe this deliverable will create this impact
- Example: "Usage dashboard showing proximity to plan limits"
- Can be: feature, content, process change, integration, experiment

## Process (ST-Driven)

### Step 1: Define Goal
Use `mcp__sequential-thinking__sequentialthinking` to validate:
- Is this goal measurable and time-bound?
- Is this the highest-leverage goal right now?
- What is the current baseline and target?

### Step 2: Map Actors
For each goal, brainstorm all actors:
- Whose behavior can make or break this goal?
- Who are the highest-leverage actors? (small behavior change → big goal impact)
- Who are we ignoring that matters?

### Step 3: Define Impacts
For each high-leverage actor:
- What behavior change would move the goal metric?
- What is the actor doing today vs what we want?
- Which impacts are measurable? (if not measurable, refine)

### Step 4: Hypothesize Deliverables
For each impact:
- What is the cheapest experiment to test if we can create this impact?
- What existing feature/content could be modified vs built from scratch?
- Apply Adopt-First Gate: does a solution already exist?

### Step 5: Validate & Prioritize
- Score each deliverable: `Goal contribution × Confidence × (1/Effort)`
- Kill deliverables that can't trace clearly back to the goal
- Identify the shortest path: fewest deliverables to test the most impacts

## Impact Map Template

| Goal | Actor | Impact | Deliverable | Confidence | Effort | Priority |
|------|-------|--------|-------------|------------|--------|----------|
| {SMART goal} | {who} | {behavior change} | {what to build/do} | H/M/L | S/M/L | P0/P1/P2 |

## Integration Points

### Impact Map → PRD
- Goal → PRD strategic context and success metrics
- Actor → PRD target users
- Impact → PRD goals (behavior changes to achieve)
- Deliverable → PRD requirements (scoped by impact, not wishlist)
- Non-mapped features → PRD non-goals (if it doesn't trace to a goal, why build it?)

### Impact Map → Roadmap
- Impact Map validates roadmap prioritization: "Does this roadmap item trace to a goal?"
- Multiple deliverables per impact → sequence by confidence (test cheapest first)
- Goal changes → roadmap pivot trigger

### Impact Map → Discovery
- Impact Map identifies which actor-impact pairs need validation
- Discovery mode validates: "Can we actually create this impact?"
- Discovery red flags → prune Impact Map branches

### Impact Map → Ideation
- Underserved impacts (no good deliverable ideas) → ideation brief
- Impact Map frames brainstorm: "How might we cause {impact} for {actor}?"

## Quality Checks

| Check | Question |
|-------|----------|
| Goal clarity | Is the goal SMART with a current baseline? |
| Actor completeness | Have we considered all actor types (users, internal, external, negative)? |
| Impact measurability | Can we measure the behavior change for each impact? |
| Deliverable traceability | Does every deliverable trace to exactly one impact? |
| Waste detection | Are there deliverables with no clear impact? Remove them. |
| Assumption surfacing | Which actor-impact links are assumptions vs evidence? |

## Anti-Patterns

- **Feature-first mapping**: Starting from deliverables and mapping backwards (rationalization, not strategy)
- **Too many actors**: >5 actors per goal = lack of focus. Prioritize.
- **Vague impacts**: "Users are happier" — not measurable, not actionable
- **1:1 mapping**: Every goal has exactly one actor with one impact → probably not thinking hard enough
- **Stale maps**: Impact Maps are living documents. Revisit quarterly or when strategy shifts.

## Persist Output
- Artifact: `lore create knowledge --parent <spec or prd it concerns> --sub-type research --title '{goal} Impact Map' --content ...`
- Link to: PRDs derived from this map (`lore link <impact-map> <prd> --type=informs`)

## Triggers
"Impact map", "Strategy to features", "Why are we building this", "Goal alignment",
"Feature justification", "Trace back to business goal", "OKR to roadmap"
