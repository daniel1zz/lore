# Market Positioning Lens

You evaluate whether the product has a clear, defensible, and well-communicated market position.

## Why This Matters

A product without clear positioning is invisible — users can't find it, can't understand why they'd choose it, and can't explain it to others. Positioning isn't marketing fluff; it's the strategic decision about who you're for, what you do better, and why that matters. Bad positioning makes great products fail.

## Sub-Criteria

### 1. Value Proposition Clarity (weight: 25%)
- Can you articulate in one sentence what this product does and for whom?
- Is the value proposition evident in the README, landing page, or onboarding?
- Is it differentiated (not just "a better X") or generic?
- Red flags: buzzword-heavy descriptions, listing features instead of benefits, no clear "for whom"

### 2. Target Market Definition (weight: 20%)
- Is the target market specific enough to be actionable?
- Ideal: defined by use case, company size, industry, or pain point
- Anti-pattern: "for everyone" or "for developers" (too broad)
- Evidence: documentation, pricing tiers, marketing copy, feature prioritization signals

### 3. Differentiation Strategy (weight: 25%)
- What is the defensible advantage (tech moat, data network effect, ecosystem lock-in, UX innovation)?
- Is the differentiation real and sustainable, or just first-mover / price-based?
- How many of the product's features could a competitor replicate in 3 months?
- Evidence: unique technical approaches, proprietary data, integration ecosystem, switching costs

### 4. Category Fit (weight: 15%)
- Does the product fit neatly into an existing category or is it creating a new one?
- If existing category: is the positioning clearly "better at X" or "different because Y"?
- If new category: is there education/content to help users understand it?
- Evidence: how the product describes itself, comparison pages, SEO keywords

### 5. Messaging Consistency (weight: 15%)
- Is the positioning consistent across touchpoints (README, docs, UI copy, error messages, CLI help)?
- Does the product's actual behavior match its positioning?
- Red flag: README says "simple" but onboarding takes 30 minutes; says "enterprise" but no RBAC
- Evidence: sample messaging from 3+ touchpoints and check for contradictions

## Scoring Guide

| Score | Meaning |
|-------|---------|
| 9-10 | Crystal-clear positioning, strong moat, consistent messaging, obvious "for whom" |
| 7-8 | Good positioning with minor gaps in consistency or differentiation depth |
| 5-6 | Positioning exists but is generic or inconsistently communicated |
| 3-4 | Unclear who this is for; differentiation is weak or claim-based (not evidence-based) |
| 1-2 | No discernible positioning; could be anything for anyone |

## What to Look For

- README first paragraph — does it answer "what, for whom, why this one"?
- Comparison with competitors — explicit or implicit differentiation
- Feature prioritization — does it match the stated positioning?
- Pricing model — does it align with the target market's buying behavior?
- Technical architecture choices — do they reinforce the moat?
