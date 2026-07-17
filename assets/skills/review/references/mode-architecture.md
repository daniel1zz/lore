# Mode: architecture - Architecture & Design Review

**Purpose**: Architecture and design review using structured evaluation procedures

## Workflow

```yaml
workflow:
  1_doc_first:
    action: "Load existing architecture context — don't flag what's intentional"
    steps:
      - "`lore search \"<q>\" --type adr --json` for ADRs, design docs, module diagrams"
      - "Load project's stated architecture style (layered, hexagonal, microservices, etc.)"
    tools: [lore search, lore get]
    output: "Architecture context brief (style, key ADRs, known tradeoffs)"

  2_automation:
    action: "Suggest or check automated architecture tools"
    recommend: [madge --circular, dependency-cruiser, bundle analyzers, knip]
    note: "Cite tool output as HIGH confidence evidence"

  3_official_docs:
    action: "Check framework-specific architecture patterns"
    tools: [context7 query-docs, mcp-deepwiki ask_question]
    when: "Changed code involves framework-level decisions (routing, state management, data layer)"

  4_evaluation:
    action: "Structured architecture evaluation — see procedures below"
    procedure: "§1 through §4 in order"
    tool: "MUST use mcp__sequential-thinking__sequentialthinking for change impact analysis"

  5_output:
    action: "Report findings with architectural evidence"
```

---

## §1 Dependency Graph Analysis

Map and verify the dependency structure of changed code.

```yaml
dependency_analysis:
  step_1_map_imports:
    action: "For each changed file, list its imports and who imports it"
    tool: "serena get_symbols_overview — get exports/imports per file"
    tool_alt: "serena find_referencing_symbols — find who depends on changed symbols"
    output: "Dependency map: file → [dependencies] and file → [dependents]"

  step_2_verify_direction:
    action: "Check dependency direction against project's architecture style"
    rules:
      layered:
        allowed: "presentation → application → domain; infrastructure → domain (implements)"
        forbidden: "domain → infrastructure, domain → presentation, application → presentation"
      hexagonal:
        allowed: "adapters → ports → domain; driving adapters inward, driven adapters outward"
        forbidden: "domain → adapters, ports → adapters"
      modular:
        allowed: "module → shared; module → module via public API only"
        forbidden: "module → module internal (bypass public API)"
    tool: "serena find_referencing_symbols — trace cross-layer imports"
    violation: "Dependency direction violation → BLOCKER"

  step_3_detect_cycles:
    action: "Check for circular dependencies in or introduced by changed code"
    tool: "serena find_referencing_symbols — trace A→B, then check if B→...→A"
    note: "If madge/dependency-cruiser output available, cite it"
    violation: "Circular dependency → BLOCKER"

  step_4_coupling_assessment:
    action: "Assess coupling level of changed code"
    metrics:
      afferent: "How many modules depend on this? (high = stable, don't change interface)"
      efferent: "How many modules does this depend on? (high = fragile, sensitive to changes)"
    concern: "High afferent + high efferent = zone of pain (unstable core dependency)"
```

---

## §2 Boundary Integrity Check

Verify architectural boundaries are respected by changed code.

```yaml
boundary_check:
  step_1_identify_crossings:
    action: "List all module/layer boundary crossings in the changed code"
    detect:
      - "Import from a different architectural layer"
      - "Import from a different bounded context or module"
      - "Direct instantiation of a class from another module (instead of via interface)"
    tool: "serena find_referencing_symbols — trace imports crossing boundaries"

  step_2_verify_contracts:
    action: "For each crossing, verify it goes through a defined interface"
    check:
      - "Is the import targeting a public API (index.ts, public module exports)?"
      - "Or does it reach into internal implementation files?"
      - "Does it depend on a concrete class or an abstraction/interface?"
    violation:
      internal_import: "Importing from module internals (not public API) → MAJOR"
      concrete_dependency: "Depending on concrete implementation instead of interface → MAJOR (DIP violation)"
      no_boundary: "No clear boundary between modules that should be separate → MINOR (tech debt)"

  step_3_abstraction_stability:
    action: "Verify abstractions at boundaries are stable"
    check:
      - "Would this coupling survive if the depended-on module were replaced?"
      - "Does the interface expose implementation details? (leaky abstraction)"
      - "Are domain types used at boundaries instead of infrastructure types?"
```

---

## §3 Change Impact Analysis (MUST use Sequential Thinking)

Use `mcp__sequential-thinking__sequentialthinking` to reason about architectural consequences.

```yaml
impact_analysis:
  trigger: "Changed code modifies a public API, introduces a new module, or changes dependency graph"
  tool: "mcp__sequential-thinking__sequentialthinking"

  reasoning_prompts:
    ripple_effect:
      question: "What would break if this module's interface changed again?"
      trace: "Use serena find_referencing_symbols to find all consumers"
      assess: "Count and classify impact: same-layer (expected) vs cross-layer (concerning)"

    future_change_cost:
      question: "For a likely future change in this area, how many files would need updating?"
      examples: "Adding a new field, new operation, new provider/adapter"
      red_flag: "If many unrelated modules need coordinated changes for a single logical change → shotgun surgery smell → severity based on coupling depth"

    blast_radius:
      question: "Is the blast radius proportional to the change?"
      check: "Small logical change requiring many file touches = poor architecture"
      check: "Large logical change contained within one module = good architecture"

    replaceability:
      question: "Could this component be swapped out without modifying its consumers?"
      check: "If no → tight coupling, DIP violation likely"
```

---

## §4 ADR Compliance Verification

Verify changed code follows documented architecture decisions.

```yaml
adr_compliance:
  step_1_load_adrs:
    action: "Search the lore corpus for ADRs (Architecture Decision Records) relevant to changed code"
    tool: "lore search \"{keywords from changed files}\" --type adr --json"
    fallback: "lore search \"{keywords}\" --type spec --json (design-kind spec)"

  step_2_check_compliance:
    action: "For each relevant ADR, verify the changed code complies"
    check:
      - "Does the code follow the decided approach (not a rejected alternative)?"
      - "Does the code respect constraints documented in the ADR?"
      - "If the code contradicts an ADR, is the ADR superseded by a newer one?"
    violation:
      contradicts_active_adr: "→ BLOCKER (unless ADR needs updating — flag for discussion)"
      no_adr_for_decision: "Architectural decision without ADR → MINOR (suggest creating one)"

  step_3_decision_tracking:
    action: "If review reveals an undocumented architecture decision, flag it"
    output: "Suggest creating ADR via `lore create adr --title ... --decision-status proposed`"
```

---

## Evaluation Criteria Summary

Quick-reference for reviewers (detailed procedures above take priority):

| Dimension | Procedure | Key Question | Violation Severity |
|-----------|-----------|-------------|-------------------|
| Dependency Direction | §1 step 2 | Do deps flow inward? | BLOCKER |
| Circular Dependencies | §1 step 3 | Any cycles? | BLOCKER |
| Boundary Integrity | §2 | Through public API? | MAJOR |
| Coupling Level | §1 step 4 | Proportional to stability? | MAJOR |
| Change Impact | §3 | Blast radius reasonable? | MAJOR |
| ADR Compliance | §4 | Follows documented decisions? | BLOCKER |
| Interface Stability | §2 step 3 | Abstractions leak-free? | MINOR |

## Tools
- Code: serena (find_symbol, get_symbols_overview, find_referencing_symbols — essential for dependency tracing)
- Docs: lore CLI (ADRs, design docs), context7 (framework patterns), mcp-deepwiki
- PR: github (get_diff, get_files, add_comment_to_pending_review)
- Reasoning: mcp__sequential-thinking__sequentialthinking (mandatory for §3)

## Exit Criteria (architecture-specific)

```yaml
architecture_exit_gates:
  dependency_mapped: "All changed files' dependencies traced"
  boundaries_checked: "All cross-boundary imports verified"
  impact_assessed: "Change impact analysis completed (ST used if non-trivial)"
  adrs_checked: "Relevant ADRs loaded and compliance verified"
```
