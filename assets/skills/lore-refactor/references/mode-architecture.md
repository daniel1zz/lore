# Mode: architecture - Architectural Refactoring

**Purpose**: Architectural refactoring for better structure

## Scope

```yaml
scope:
  - Module restructuring
  - Layer separation
  - Dependency inversion
  - Service extraction
  - API boundary definition

patterns:
  layered_architecture:
    layers: [presentation, business, data]
    direction: "Dependencies point inward"

  clean_architecture:
    layers: [entities, use_cases, interfaces, frameworks]
    rule: "Inner layers don't know about outer layers"

  microservices:
    considerations:
      - Service boundaries
      - Data ownership
      - Communication patterns
      - Deployment independence

  modular_monolith:
    approach: "Strong module boundaries within single deployment"
    benefits: "Easier to split later if needed"

common_refactorings:
  - Extract service from monolith
  - Split module into submodules
  - Introduce repository pattern
  - Add service layer
  - Implement dependency injection
```

## Architecture Refactoring Workflow

```yaml
steps:
  0_load_context:
    actions:
      - "Load ADRs + tech-specs from the lore corpus: `lore search \"<topic>\" --type adr --json` / `lore search \"<topic>\" --type spec --json`"
      - "Load project architecture docs: `lore tree` (hierarchy) or `lore search \"architecture\" --type spec --json`"
      - Load ADRs for architectural constraints
      - Load design specs for current architecture
    output:
      - Architectural constraints to respect
      - API contracts to preserve

  0.5_check_tools_and_docs:
    description: "Use automated analysis tools and query docs for architecture patterns"
    actions:
      - Run dependency analysis tools (Madge, dependency-cruiser) for dependency graph
      - "If architecture involves specific frameworks, query context7 (P1) / gitmcp (P2) for official patterns"
      - Check for circular dependencies automatically before manual review
    rule: "Prefer automated dependency analysis over manual code tracing"

  1_assess:
    actions:
      - Map current module structure
      - Identify coupling and cohesion issues
      - Review dependency graph (from automated tools in step 0.5)
      - Cross-reference with loaded ADRs
    tools:
      - serena: get_symbols_overview
      - serena: find_referencing_symbols (dependency analysis)

  2_plan:
    actions:
      - Define target architecture
      - Plan incremental migration path
      - Identify risks and breaking changes
      - Verify plan respects ADR constraints
    output:
      - Architecture diagram (before/after)
      - Migration phases
      - ADR compliance check

  3_prepare:
    actions:
      - Ensure integration tests exist
      - Define API contracts for new boundaries
      - Create checkpoint (stash or local patch; do not commit unless user explicitly asks)

  4_refactor:
    actions:
      - Apply one architectural change at a time
      - Run tests after each change
      - Verify API contracts preserved
      - Record checkpoint if green
    tools:
      - serena: rename_symbol
      - serena: replace_symbol_body
      - serena: insert_after_symbol
      - serena: create_text_file (new modules)

  5_verify:
    actions:
      - "Run full test suite (Gate 3 — see references/quality-gates.md)"
      - Verify dependency direction (no upward dependencies)
      - Check for circular dependencies (Madge/dependency-cruiser)
      - Review API boundary integrity
      - "Produce verification evidence (Gate 4 — before/after metrics table)"
      - "ALWAYS trigger review skill handoff for architecture refactoring (see references/skill-handoff.md)"
```

## ADR Integration

```yaml
lore_integration:
  create_adr_if_architectural:
    condition: "Refactoring involves architectural decisions"
    tool: "lore create adr --title 'Refactoring Decision: {description}' --decision-status proposed --tags 'refactor,{component}' --content '{rationale, owned by {team}}'"
    link_to_existing:
      tool: "lore link {adr_id} {design_spec_id} --type=supersedes"
```
