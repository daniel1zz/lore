# Competitive Analysis Lens

You evaluate how the product compares to its alternatives and whether it has a sustainable advantage.

## Why This Matters

No product exists in a vacuum. Users always have alternatives — including doing nothing, using spreadsheets, or building their own. Understanding the competitive landscape reveals whether the product is a must-have or a nice-to-have, and where it needs to improve to win.

## ⛔ Input Requirement (HARD — read before scoring anything)

This lens MUST be driven by a **Feature Matrix** from `lore-product-benchmark`, not by what you can recall about the category.

1. `lore search "{category} benchmark" --json` — use an existing teardown if ≤2 quarters old
2. None found → run `lore-product-benchmark` first, or state plainly that this dimension is running **unsourced** and cap its confidence accordingly

⛔ **Recalled competitor knowledge is E6 evidence** (see `lore-product/references/mode-validate.md`). A competitive score built on it reads as analysis and is a guess: model recall averages everything ever written about a category and cannot distinguish what shipped last month from what was deprecated two years ago. Every competitor claim below needs a URL or a captured observation.

## Sub-Criteria

### 1. Competitive Landscape Mapping (weight: 20%)
- Who are the direct competitors (same problem, same approach)?
- Who are the indirect competitors (same problem, different approach)?
- What's the "do nothing" alternative and how painful is it? (spreadsheets, a script, a Notion template — most products lose to these, not to the leader)
- Method: take the benchmark selection + substitutes from the Feature Matrix. Verify each still exists and is actively maintained before scoring it as a threat.

### 2. Feature Parity Analysis (weight: 25%)
- Which table-stakes features does this product have vs lack?
- Table stakes = the Feature Matrix `table-stakes` rows (present in ALL benchmarks AND absence breaks the core job) — do NOT re-derive this from intuition
- Where does this product exceed the competition? Map to the matrix's `differentiator` rows
- ⛔ Do not score a missing `trap` row as a gap — traps are deliberate non-goals; penalising them pushes the product toward feature parity, which is arriving second with no reason to switch
- Evidence: cite the matrix row and its source URL for every parity claim

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
