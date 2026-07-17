# Roadmap Planning Reference

## Roadmap Formats

| Format | Best For | Pros | Cons |
|--------|----------|------|------|
| Timeline | External comms, sales alignment, contracts | Clear deadlines, easy to communicate | Commitment anxiety, false precision |
| Now-Next-Later | Agile teams, uncertain timelines | Flexible, reduces false precision | Less concrete for stakeholders |
| Objective-based | OKR organizations | Strategy-aligned, outcome-focused | Less timeline clarity |
| Theme-based | Multi-product/platform teams | Clear categorization, easy to balance | Cross-theme deps unclear, no sequence |

### Now-Next-Later Detail
- **Now**: In progress, high certainty, sprint-level detail
- **Next**: Up next, medium certainty, scoped and ready
- **Later**: Future consideration, low certainty, themes only
- Transitions: later→next (prioritized+scoped), next→now (current completes), any→removed (deprioritized)

## Roadmap Process
1. **Gather inputs**: Strategy/OKRs, customer feedback, sales requests, tech debt, competitive analysis, market trends
2. **Organize**: Group related items, identify dependencies, spot conflicts
3. **Prioritize**: RICE / MoSCoW / Impact-Effort; consider strategic alignment, customer value, feasibility, resources
4. **Sequence**: Dependencies, market timing, resources, risk, quick wins first
5. **Validate**: Eng feasibility, sales/success alignment, exec approval, resource commitment
6. **Communicate**: Tailor per audience (see below)

## Stakeholder Views

| Audience | Focus | Detail | Frequency | Format |
|----------|-------|--------|-----------|--------|
| Executives | Strategy, outcomes | High-level themes | Quarterly | Objective/timeline |
| Engineering | Scope, dependencies | Feature specs | Sprint | Now-Next-Later |
| Sales | What to sell, when | Customer-facing features | Monthly | Timeline w/ caveats |
| Customers | Value received | Benefits not features | Quarterly | Theme-based, no dates |

Internal: more detail, tentative dates, show uncertainty. External: themes/problems, avoid dates, disclaimers, shorter horizon.

## MVP Planning

Types: concierge (manual behind scenes), wizard-of-oz (looks automated), landing page (test demand), single feature (core value), piecemeal (cobble existing tools)

### Scoping MVP
1. Define success: hypothesis, learning goal, minimum evidence, decision informed
2. Core job (JTBD): #1 thing users hire this for → single primary use case
3. Map flow: entry → core action → success state (critical paths only)
4. Cut scope: keep core value + critical path + minimum UX; cut edge cases, nice-to-haves, perfection, scalability
5. Define out-of-scope: what's NOT in MVP, why cut, when might return

## Review Cadence
- **Weekly** (PM + Tech Lead): Progress, blockers, near-term adjustments
- **Monthly** (Product + stakeholders): Progress vs plan, reprioritize, evaluate new items
- **Quarterly** (Leadership): Results vs goals, market changes, major pivots, next quarter planning

Signals to change: market shift, competitive threat, customer feedback pattern, technical constraint, resource change, strategy shift

## Quarterly Planning
Timeline: W-4 gather → W-3 draft → W-2 align → W-1 finalize → W0 start
Inputs: look back (results, carry-over), look around (market, competition, feedback), look ahead (strategy, targets, resources)
Outputs: 3-5 objectives, 2-4 KRs each, initiatives mapped, capacity allocation, dependencies, risks

## Portfolio Balance
- Time: 60% short / 30% medium / 10% long
- Risk: 70% safe / 20% calculated / 10% moonshots
- Work: 50% features / 25% improvements / 15% maintenance / 10% exploration
- Anti-patterns: 100% features 0% debt, only safe bets, only long-term, ignoring maintenance
