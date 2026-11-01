# Mode: Roadmap

**Purpose**: Plan product roadmap with strategic clarity, not just feature lists

## Strategic Questions (Ask First)
- What strategic objective does this roadmap serve?
- What does winning look like in 6/12/24 months?
- What are we betting on? What would cause a direction change?

## Prioritization Anti-Patterns
Squeaky wheel customers, HiPPO-driven, roadmap by committee, feature parity obsession

## Better Prioritization Questions
- What moves the key metric most?
- What has asymmetric upside?
- What compounds over time?
- What de-risks future bets?

## Sequencing Principles
Learn before scale → Quick wins build trust → Dependencies dictate sequence → Leave room for pivots

## Prioritization Frameworks

| Framework | When | Key |
|-----------|------|-----|
| RICE | Quantitative comparison needed | Numbers only as good as estimates |
| ICE | Quick scoring | Impact × Confidence × Ease |
| Opportunity Scoring | Finding gaps | Importance × (Importance - Satisfaction) |

## Roadmap Formats

| Format | Best For | Trade-off |
|--------|----------|-----------|
| Now-Next-Later | Agile teams, uncertainty | Commits to direction not dates |
| Objective-based | OKR organizations | Ties features to outcomes |
| Timeline | External communication | Creates false precision |

## Impact Map Validation (RECOMMENDED)

Before finalizing roadmap, validate against Impact Map (see [impact-mapping.md](impact-mapping.md)):
- Every roadmap item should trace to a Goal→Actor→Impact→Deliverable chain
- Items that don't trace back → challenge: why are we building this?
- Impact Map highlights highest-leverage deliverables → should be prioritized
- Unvalidated impact hypotheses → mark as "needs discovery" before committing

## Cross-Cutting Concerns Gate (MANDATORY)

Before finalizing roadmap, verify:
- [ ] **Privacy debt**: Are we accumulating data collection without privacy infrastructure?
- [ ] **Accessibility debt**: Are we shipping features without a11y, planning to "add later"?
- [ ] **Ethical review**: Has any roadmap item been flagged for ethical concerns?
- [ ] **Sustainability**: Does the roadmap include maintenance/tech-debt allocation?

See [cross-cutting-concerns.md](cross-cutting-concerns.md) for full framework.

## Required Output
- Roadmap doc via `lore template show prd --blank` → fill → `lore create prd --title '<roadmap-title>' --fields-file f.yaml` (the living-root strategic doc)
- Per-theme epic doc via `lore template show plan --blank` → fill → `lore create plan --title '<theme>' --parent <roadmap-prd> --fields-file f.yaml`
- Link epics to roadmap via `lore link <epic-plan> <roadmap-prd> --type=implements`
- Strategic context (why this sequence)
- Trade-offs explicitly stated
- What we're NOT doing
- Success criteria for roadmap itself

## Exit Criteria

Roadmap is complete when:
- [ ] All items prioritized with explicit framework (RICE/MoSCoW/Impact-Effort)
- [ ] Strategic context documented (why this sequence, not another)
- [ ] Trade-offs and non-goals explicitly stated
- [ ] Impact Map alignment verified (if map exists)
- [ ] Cross-cutting concerns checklist passed
- [ ] Stakeholder views generated per audience (exec/eng/sales/customer)
- [ ] Review cadence established
- [ ] Output persisted in the lore corpus with epic-plan links

## Triggers
"Create roadmap", "Prioritize features", "What should we build first", "Release planning"
