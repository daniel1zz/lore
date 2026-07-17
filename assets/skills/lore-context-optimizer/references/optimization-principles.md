# Optimization Principles

## Compression Patterns

| Pattern | Before | After |
|---------|--------|-------|
| Nested lists | Category+items prose | Table |
| Prose logic | "When X, check Y, if true Z else W" | `X → Check Y → True:Z \| False:W` |
| Repeated examples | Multiple example→response pairs | `Pattern: How→Steps \| What→Def \| Why→Explanation` |
| Verbose templates | Multi-line format instructions | `Format: Title \| Description \| Details` |
| Over-nested hierarchy | 4-5 levels deep | Flatten to 2 levels |
| Fragmented sections | Prerequisites + Requirements + Dependencies | Merged: "Setup Requirements" |

## What to Remove vs Keep

**Remove** (LLM already knows): standard programming concepts, common design patterns, basic best practices, general tool usage, standard file formats

**Keep**: company-specific workflows, custom tool configs, domain terminology, project constraints, unique integration patterns

## Redundancy Types

1. **Exact repetition** → consolidate to single global rule
2. **Semantic repetition** → merge into one statement
3. **Verbose explanations** → concise imperative

## Progressive Disclosure

**In main doc** (>80% use cases): essential workflow, critical constraints, top 3-5 patterns, links to references

**In reference files** (<20% use cases): comprehensive examples, edge cases, advanced techniques, detailed API docs

## Quality Checks

After optimization verify:
- Core workflow still executable
- Critical constraints preserved
- No ambiguity introduced
- Unique context maintained

**Stop if**: workflow becomes ambiguous, critical info lost, multiple interpretations possible
