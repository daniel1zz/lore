# Technical Planning Guide

> Product-level view. Full tech spec authoring → `design`/`implement` skill.

## Tech Spec Sections (Product → Engineering Handoff)
1. **Overview**: Problem, proposed solution, goals/non-goals, metrics
2. **Background**: Current state, why now, prior art
3. **Design**: Architecture (high-level), API surface, data model, security
4. **Alternatives**: Option A/B/C with trade-offs, why chosen wins
5. **Implementation**: Phases/milestones, cross-team dependencies, rollout strategy
6. **Open questions**: Unresolved decisions needing input

## T-Shirt Sizing

| Size | Duration | Note |
|------|----------|------|
| XS | < 1 day | Trivial |
| S | 1-2 days | Small feature/bugfix |
| M | 3-5 days | Standard feature |
| L | 1-2 weeks | Complex feature |
| XL | 2-4 weeks | Needs breakdown |
| XXL | > 4 weeks | Must break down before committing |

Three-point: Expected = (O + 4M + P) / 6. Always communicate ranges, not points.

Anti-patterns: estimates as commitments, cross-team velocity comparison, estimating without eng input, no buffer

## Risk Matrix
Score = Likelihood(1-5) × Impact(1-5). Low: 1-6, Medium: 7-14 (needs mitigation), High: 15-25 (needs escalation/scope change)

Common risks: integration (API changes), performance (scaling), security (breaches), complexity (scope creep), dependencies (blockers)

## Capacity Allocation

| Category | Allocation |
|----------|-----------|
| Features | 60-70% |
| Bugs | 15-20% |
| Tech debt | 10-15% |
| Exploration | 5-10% |

Portfolio: 60% short / 30% medium / 10% long-term. Risk: 70% safe / 20% calculated / 10% moonshots.
Anti-patterns: 100% features 0% debt, only safe bets, no unplanned buffer.
