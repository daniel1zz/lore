# Refactoring Catalog - Quick Reference

> Claude already knows these techniques. This file serves as a **decision index** — use it to identify the right refactoring, then apply it directly.
> For **smell detection methodology** (what to look for, detection thresholds, tool matrix): see `references/smell-detection.md`
> For **when to stop** (quality gates, exit criteria, abort triggers): see `references/quality-gates.md`

## Composing Methods

| Technique | When to Use |
|-----------|-------------|
| Extract Method | Long method, code needs explanation, duplication |
| Inline Method | Body is as clear as name, too simple to justify |
| Extract Variable | Complex expression, used multiple times |
| Replace Temp with Query | Temp holds expression needed elsewhere (only if cheap) |

## Simplifying Conditionals

| Technique | When to Use |
|-----------|-------------|
| Decompose Conditional | Complex conditional with complicated branches |
| Guard Clauses | Deep nesting, multiple early exits, happy path obscured |
| Consolidate Conditional | Multiple conditions with same result |
| Replace Conditional with Polymorphism | Switch/if-else on type, same conditional in multiple places |

## Moving Features

| Technique | When to Use |
|-----------|-------------|
| Move Method | Method uses more features of another class |
| Move Field | Field used more by another class |
| Extract Class | Class does too many things, subset forms logical unit |

## Organizing Data

| Technique | When to Use |
|-----------|-------------|
| Replace Primitive with Object | Primitive represents domain concept with behavior |
| Replace Type Code with Enum | Type code controls behavior, needs type safety |
| Encapsulate Collection | Collection exposed directly, need controlled access |

## Generalization

| Technique | When to Use |
|-----------|-------------|
| Pull Up Method | Subclasses have identical methods |
| Push Down Method | Method only relevant to some subclasses |
| Extract Interface | Multiple classes share behavior, need decoupling |
| Replace Inheritance with Delegation | "Is-a" doesn't fit, only uses part of superclass |

## API Refactoring

| Technique | When to Use |
|-----------|-------------|
| Rename Method/Variable | Name doesn't reveal intent |
| Separate Query from Modifier | Method both returns value and has side effects |
| Parameterize Method | Multiple methods do similar things with different values |

## Automation-First Principle

Before manual refactoring, check for automated tools:

```yaml
automated_tools:
  codemod: "jscodeshift, ts-morph, gomod — for large-scale AST transforms"
  linter_autofix: "ESLint --fix, Biome, Ruff — for style/pattern enforcement"
  ide_refactoring: "Serena rename_symbol — for safe cross-codebase renames"
  framework_codemods: "Query via context7/gitmcp for framework-specific codemods"
```

> **Rule**: If a codemod or auto-fix tool exists for the refactoring, use it instead of manual changes.
