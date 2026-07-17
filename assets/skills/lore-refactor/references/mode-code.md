# Mode: code - Code-Level Refactoring

**Purpose**: Code-level refactoring for improved quality

## Scope

```yaml
scope:
  - Extract methods/functions
  - Rename for clarity
  - Simplify conditionals
  - Remove duplication
  - Improve abstractions
  - Apply design patterns

safety:
  - Ensure tests pass before and after
  - Make small, incremental changes
  - Use version control checkpoints
```

## Code Refactoring Workflow

```yaml
steps:
  0_load_context:
    actions:
      - "Load ADRs + tech-specs from the lore corpus: `lore search \"<topic>\" --type adr --json` / `lore search \"<topic>\" --type spec --json`"
      - "Load project architecture docs: `lore tree` (hierarchy) or `lore search \"architecture\" --type spec --json`"
      - Identify architectural constraints from loaded docs
      - Understand design intent
    output:
      - Constraints to respect
      - Behaviors to preserve

  0.5_check_automation_tools:
    description: "Prefer automated refactoring over manual changes"
    mandatory: true
    actions:
      - Check if Serena rename_symbol can handle renames
      - Check if linter auto-fix covers the refactoring (ESLint --fix, Biome)
      - Check if a codemod exists for the pattern (jscodeshift, ts-morph)
      - For framework-specific refactoring, query context7/gitmcp for official codemods
    rule: "If an automated tool can do it, use it instead of manual refactoring"

  0.7_conditional_docs_lookup:
    description: "Query docs when refactoring involves framework-specific patterns"
    trigger: "Refactoring touches framework APIs, hooks, lifecycle, or patterns"
    actions:
      - "Query context7 (P1) for current best practices: resolve-library-id → query-docs"
      - "Query gitmcp (P2) if context7 lacks coverage: search_generic_documentation"
      - Verify the refactored pattern follows latest official recommendations
    examples:
      - "React class → hooks: query React docs for hooks best practices"
      - "Express middleware refactoring: query Express docs for middleware patterns"
      - "Vue Options API → Composition API: query Vue docs for migration guide"

  1_assess:
    actions:
      - "Run smell detection pipeline (see references/smell-detection.md — steps 1-4)"
      - "Use smell catalog tables to identify and classify detected smells"
      - Measure complexity metrics (cyclomatic, LOC, parameter count)
      - Review test coverage against thresholds (references/quality-gates.md)
      - Cross-reference with loaded context
    tools:
      - serena: get_symbols_overview
      - serena: find_symbol (depth analysis)
      - serena: find_referencing_symbols (dead code / coupling)

  2_plan:
    actions:
      - List refactoring steps
      - Order by dependency
      - Identify risks
      - Verify plan respects ADR constraints
    output:
      - Refactoring checklist
      - Estimated effort
      - ADR compliance check

  3_prepare:
    actions:
      - Ensure tests exist
      - Add tests if needed
      - Create checkpoint (stash or local patch; do not commit unless user explicitly asks)
    tools:
      - serena: execute_shell_command (run tests)

  4_refactor:
    actions:
      - Apply single refactoring
      - Run tests
      - Record checkpoint if green (no commit unless user explicitly asks)
      - Repeat
    tools:
      - serena: rename_symbol
      - serena: replace_symbol_body
      - serena: insert_after_symbol

  5_verify:
    actions:
      - "Run full test suite (Gate 3 — see references/quality-gates.md)"
      - Check for regressions — no metric may worsen vs baseline
      - "Produce verification evidence (Gate 4 — before/after metrics table)"
      - "If high structural impact or architecture-level: trigger review skill handoff (see references/skill-handoff.md)"
    tools:
      - serena: execute_shell_command
```

## Refactoring Plan Template

```markdown
# Refactoring Plan: {Target}

## Current State Analysis

### Code Metrics
| Metric | Current | Target |
|--------|---------|--------|
| Cyclomatic Complexity | {n} | < 10 |
| Lines per function | {n} | < 50 |
| Test Coverage | {n}% | > 80% |

### Identified Issues
1. **{Issue}**: {Description}
   - Location: {file:line}
   - Impact: {High/Medium/Low}
   - Automation: {codemod available / linter rule / manual only}

## Refactoring Steps

### Phase 1: Preparation
- [ ] Add missing tests for {component}
- [ ] Create safety checkpoint

### Phase 2: Refactoring
- [ ] Step 1: {Description}
- [ ] Step 2: {Description}

### Phase 3: Verification
- [ ] All tests pass
- [ ] No new warnings
- [ ] Performance unchanged
```
