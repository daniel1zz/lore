# Analysis Checklist

## Pre-Analysis

- Document type, target audience, optimization goal
- Must preserve / cannot change constraints
- Target reduction %

## Structure Analysis

| Check | Action |
|-------|--------|
| Section inventory | Lines, % of total, essential?, reducible? |
| Hierarchy | Max nesting depth, sections >3 levels → flatten |
| Redundancy | Mergeable sections, consolidatable lists |

## Content Classification

| Layer | Action | Examples |
|-------|--------|----------|
| **Essential** (keep) | Core workflows, unique constraints, critical principles | — |
| **Valuable** (keep) | Domain-specific details, non-obvious patterns | — |
| **Redundant** (remove) | AI base knowledge, repeated info, verbose explanations | Standard concepts, duplicate instructions |
| **Low-value** (remove) | Unnecessary nesting, obvious examples, meta-commentary | — |

## Optimization Passes

1. **Quick wins** (low risk): remove AI base knowledge, merge sections, lists→tables, remove redundant examples
2. **Medium** (medium risk): flatten hierarchy, consolidate instructions, prose→structured, examples→references
3. **Aggressive** (high risk): maximum density, major restructure, progressive disclosure

## Post-Optimization Validation

- [ ] All workflows executable, decision points clear, constraints preserved
- [ ] No ambiguity, info actionable, context sufficient
- [ ] Target reduction achieved, density increased, redundancy eliminated
