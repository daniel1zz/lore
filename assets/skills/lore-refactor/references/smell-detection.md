# Code Smell Detection — Systematic Methodology

> Smell taxonomy, detection pipeline, thresholds, and smell-to-refactoring mapping.
> Use this as the **primary assessment framework** in mode:code and mode:debt.

## Detection Pipeline (ordered)

```yaml
pipeline:
  1_automated_scan:
    description: "Run static analysis tools FIRST — never skip"
    tools:
      complexity: "ESLint complexity rule, Biome, SonarQube cognitive complexity"
      duplication: "jscpd (JS/TS), PMD CPD (Java), Simian"
      coupling: "dependency-cruiser, Madge (circular deps)"
      coverage: "c8, istanbul, pytest-cov"
      style: "ESLint --fix, Biome check, Ruff (Python)"
    output: "Machine-readable report with file:line locations"

  2_hotspot_analysis:
    description: "Identify change-frequency x complexity hotspots"
    method: "git log --format=format: --name-only | sort | uniq -c | sort -rn"
    cross_reference: "Overlay with complexity metrics from step 1"
    rationale: "Files changed often AND complex = highest ROI refactoring targets"

  3_manual_smell_review:
    description: "Walk through smell catalog below for smells tools cannot detect"
    focus: "Design smells, abstraction issues, domain modeling defects"
    tools:
      - serena: get_symbols_overview (class/module structure)
      - serena: find_referencing_symbols (coupling analysis)

  4_prioritize:
    description: "Score each smell by severity x frequency x fix-effort"
    output: "Prioritized smell register → feeds into refactoring plan"
```

## Smell Catalog — Detection Criteria & Refactoring Mapping

### Bloaters (too large)

| Smell | Detection Criteria | Threshold | Refactoring |
|-------|-------------------|-----------|-------------|
| Long Method | Lines of code, cyclomatic complexity | >30 LOC or CC>10 | Extract Method, Decompose Conditional |
| Large Class | Number of methods + fields, multiple responsibilities | >300 LOC or >20 methods | Extract Class, Extract Subclass |
| Long Parameter List | Parameter count | >4 params | Introduce Parameter Object, Preserve Whole Object |
| Primitive Obsession | Primitives representing domain concepts | Domain value without behavior class | Replace Primitive with Value Object |
| Data Clumps | Same group of fields/params appearing together | >=3 fields in >=2 places | Extract Class, Introduce Parameter Object |

### Object-Orientation Abusers

| Smell | Detection Criteria | Threshold | Refactoring |
|-------|-------------------|-----------|-------------|
| Switch Statements | switch/if-else on type codes | Same switch in >1 place | Replace Conditional with Polymorphism |
| Parallel Inheritance | Adding subclass in one hierarchy requires adding in another | 1:1 mapping between hierarchies | Move Method, collapse hierarchies |
| Refused Bequest | Subclass uses little of parent | <30% parent members used | Replace Inheritance with Delegation |
| Temporary Field | Fields only set in certain paths | Field null/unused in most methods | Extract Class, Introduce Null Object |

### Change Preventers (resist modification)

| Smell | Detection Criteria | Threshold | Refactoring |
|-------|-------------------|-----------|-------------|
| Divergent Change | One class changed for different reasons | >2 change reasons (SRP violation) | Extract Class per responsibility |
| Shotgun Surgery | One change requires edits in many classes | >3 files for single change | Move Method, Inline Class (consolidate) |
| Feature Envy | Method uses another class's data more than its own | >50% external field access | Move Method to the envied class |

### Dispensables (can be removed)

| Smell | Detection Criteria | Threshold | Refactoring |
|-------|-------------------|-----------|-------------|
| Dead Code | Unreachable code, unused exports | 0 references (serena: find_referencing_symbols) | Safe Delete |
| Duplicated Code | Identical or near-identical blocks | jscpd >5% duplication | Extract Method, Pull Up Method, Template Method |
| Lazy Class | Class does too little to justify existence | <3 methods, <50 LOC, single delegation | Inline Class, Collapse Hierarchy |
| Speculative Generality | Unused abstractions "for the future" | Interface with 1 implementor, unused params | Inline Class, Remove Parameter, Collapse Hierarchy |
| Comments as Deodorant | Comments explaining bad code instead of fixing it | Comment explains "what" not "why" | Extract Method (make code self-documenting) |

### Couplers (excessive coupling)

| Smell | Detection Criteria | Threshold | Refactoring |
|-------|-------------------|-----------|-------------|
| Inappropriate Intimacy | Classes access each other's private fields | Bidirectional field access | Move Method, Extract Class, Hide Delegate |
| Message Chains | a.getB().getC().getD() | Chain length >2 | Hide Delegate, Extract Method |
| Middle Man | Class delegates most work to another | >50% methods are pure delegation | Remove Middle Man, Inline Method |
| Incomplete Library Class | Library missing needed functionality | Extending library class for workarounds | Introduce Foreign Method, Introduce Local Extension |

### Architecture Smells (cross-module)

| Smell | Detection Criteria | Threshold | Refactoring |
|-------|-------------------|-----------|-------------|
| Circular Dependencies | Modules depend on each other cyclically | Any cycle (Madge, dependency-cruiser) | Dependency Inversion, Extract Interface, Event Bus |
| God Module | One module everything depends on | Fan-in >10, >500 LOC | Extract Module, Establish Clear Boundaries |
| Unstable Dependencies | Stable module depends on unstable one | DIP violation | Dependency Inversion Principle |
| Layer Violation | Lower layer imports from higher layer | Any upward dependency | Move to correct layer, Introduce Interface |

## Automated Detection Tool Matrix

```yaml
tool_to_smell_mapping:
  eslint:
    detects: [Long Method (complexity), Unused Variables (Dead Code)]
    config: "complexity: ['error', 10], no-unused-vars: 'error'"

  biome:
    detects: [Style violations, complexity warnings]
    config: "biome check --apply"

  jscpd:
    detects: [Duplicated Code]
    config: "jscpd --min-lines 5 --min-tokens 50"
    threshold: ">5% duplication = action required"

  dependency-cruiser:
    detects: [Circular Dependencies, Layer Violations, Unstable Dependencies]
    config: "depcruise --validate .dependency-cruiser.cjs src"

  madge:
    detects: [Circular Dependencies]
    config: "madge --circular src/"

  sonarqube:
    detects: [All complexity smells, duplication, coverage gaps]
    note: "Most comprehensive but requires server setup"

  serena:
    detects: [Dead Code, Feature Envy, Coupling]
    methods:
      - "find_referencing_symbols: 0 refs = dead code candidate"
      - "get_symbols_overview: class structure analysis"
      - "search_for_pattern: TODO/FIXME/HACK markers"

  typescript_compiler:
    detects: [Unused imports, unreachable code, type errors]
    config: "tsc --noUnusedLocals --noUnusedParameters"
```

## Severity Classification

```yaml
severity_levels:
  critical:
    description: "Actively causing bugs, blocking changes, or security risk"
    examples: [Circular Dependencies causing load-order bugs, Dead Code with security implications]
    action: "Fix immediately — block refactoring plan on this"
    SLA: "Same session"

  high:
    description: "Significantly impedes development velocity or code comprehension"
    examples: [God Module, Shotgun Surgery, >10% duplication]
    action: "Plan and execute in current refactoring"
    SLA: "Current refactoring session"

  medium:
    description: "Causes friction but manageable"
    examples: [Long Methods, Feature Envy, Primitive Obsession]
    action: "Include if within scope, otherwise track as debt"
    SLA: "Next sprint"

  low:
    description: "Minor quality issue, boy-scout rule applicable"
    examples: [Comments as Deodorant, Lazy Class, Speculative Generality]
    action: "Fix opportunistically when touching the file"
    SLA: "Opportunistic"
```
