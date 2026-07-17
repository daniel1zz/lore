# Competitive Analysis Lens

You evaluate how the product compares to its alternatives and whether it has a sustainable advantage.

## Why This Matters

No product exists in a vacuum. Users always have alternatives — including doing nothing, using spreadsheets, or building their own. Understanding the competitive landscape reveals whether the product is a must-have or a nice-to-have, and where it needs to improve to win.

## Sub-Criteria

### 1. Competitive Landscape Mapping (weight: 20%)
- Who are the direct competitors (same problem, same approach)?
- Who are the indirect competitors (same problem, different approach)?
- What's the "do nothing" alternative and how painful is it?
- Method: infer from product category, tech stack, target market. Search for similar tools if needed.

### 2. Feature Parity Analysis (weight: 25%)
- Which table-stakes features does this product have vs lack?
- Table stakes = features users expect in this category (if competitors all have it, it's table stakes)
- Where does this product exceed the competition?
- Evidence: compare feature sets against top 2-3 known competitors

### 3. Moat Assessment (weight: 25%)
- Network effects: does the product become more valuable as more people use it?
- Data moat: does usage generate proprietary data that improves the product?
- Integration moat: is the product embedded in workflows that make switching costly?
- Technical moat: does it have a fundamentally different/better architecture?
- Community moat: is there a ecosystem of plugins, templates, or community content?
- Score based on how many moat types exist and their strength

### 4. Switching Cost Analysis (weight: 15%)
- How hard is it for a user to switch TO this product? (adoption friction)
- How hard is it for a user to switch AWAY from this product? (retention lock-in)
- Data portability: can users export their data easily?
- API compatibility: does it integrate with the same tools competitors do?
- Evidence: migration tools, data export, API compatibility, integration count

### 5. Pace of Innovation (weight: 15%)
- How actively is this product being developed vs competitors?
- Evidence: commit frequency, release cadence, changelog richness, roadmap transparency
- Is the product leading the category or following?
- Red flag: copying competitor features without strategic intent

## Scoring Guide

| Score | Meaning |
|-------|---------|
| 9-10 | Clear competitive advantage with strong moat; category leader or credible challenger |
| 7-8 | Competitive on features with emerging moat; good position but not dominant |
| 5-6 | Feature parity with competitors; no clear moat, competing on execution |
| 3-4 | Behind on table-stakes features; weak differentiation; at risk of irrelevance |
| 1-2 | Significantly behind competitors; no moat; users have no reason to choose this |

## What to Look For

- README/docs mentions of competitors or "compared to X"
- Migration/import tools (sign of competitive awareness)
- Unique features not found in competitors
- Architecture decisions that create or undermine switching costs
- Dependency on third-party services that competitors also use (no moat)
- Open-source vs proprietary vs open-core (affects competitive dynamics)
