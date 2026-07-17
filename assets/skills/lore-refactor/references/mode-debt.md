# Mode: debt - Technical Debt Management

**Purpose**: Technical debt identification and remediation

## Scope

```yaml
scope:
  - Code smell detection
  - Complexity reduction
  - Test coverage improvement
  - Documentation gaps
  - Dependency updates
  - Security vulnerabilities
```

## Technical Debt Workflow

```yaml
steps:
  0_load_context:
    actions:
      - "Load ADRs + tech-specs from the lore corpus: `lore search \"<topic>\" --type adr --json` / `lore search \"<topic>\" --type spec --json`"
      - "Load project architecture docs: `lore tree` (hierarchy) or `lore search \"architecture\" --type spec --json`"
      - Load existing debt tracking issues (GitHub search_issues)
    output:
      - Known debt items
      - Previous remediation history

  1_inventory:
    description: "Use automated tools FIRST, then manual assessment"
    actions:
      - "Run smell detection pipeline (see references/smell-detection.md — full 4-step pipeline)"
      - Run static analysis tools (ESLint, Biome, SonarQube)
      - Run security audit (npm audit, pip-audit, Dependabot alerts)
      - Check dependency freshness (npm outdated, ncu)
      - Run coverage report
      - Search for TODO/FIXME/HACK comments
      - "Run hotspot analysis: git log frequency x complexity overlay"
    tools:
      - serena: execute_shell_command (linters, scanners)
      - serena: search_for_pattern (TODO/FIXME/HACK)
      - serena: find_referencing_symbols (dead code detection)
    rule: "Always run automated detection before manual code review"

  1.5_docs_lookup_for_dependencies:
    description: "Query docs for outdated/vulnerable dependencies"
    trigger: "Dependency updates identified in inventory step"
    mandatory: true
    actions:
      - For each outdated dependency, query CHANGELOG via context7/gitmcp
      - Identify breaking changes between current and target versions
      - Check for official migration guides or codemods
      - Verify ecosystem compatibility (peer dependencies)
    tools:
      context7:
        queries:
          - "{package} breaking changes {target_version}"
          - "{package} upgrade guide from {current} to {target}"
      gitmcp:
        queries:
          - "CHANGELOG.md in {package} repo"
          - "MIGRATION.md or UPGRADE.md"

  2_prioritize:
    criteria:
      - Business impact (RICE framework — see references/debt-management.md)
      - Risk level (security vulnerabilities first)
      - Effort required
      - Dependencies between items
    output:
      - Prioritized debt register
      - Recommended remediation order

  3_plan_remediation:
    actions:
      - Create tickets for debt items (GitHub issue_write)
      - Allocate capacity (recommend 15-20% of sprint)
      - Schedule alongside feature work
      - For dependency updates: prefer automated tools (Renovate, Dependabot PRs, ncu)

  4_execute:
    actions:
      - Address high-priority items first
      - Use automated tools where possible
      - Run tests after each change
      - Track progress
    tools:
      - serena: rename_symbol, replace_symbol_body (code debt)
      - serena: execute_shell_command (dependency updates, linter fixes)

  5_verify_and_prevent:
    actions:
      - "Run exit gate checks (see references/quality-gates.md Gate 3)"
      - "Produce verification evidence (Gate 4 — before/after metrics)"
      - Update linter rules to catch new patterns
      - Add CI checks for complexity thresholds (see references/quality-gates.md thresholds)
      - Improve code review checklist
      - Document decisions in ADRs if architectural
      - "If remediation reveals bugs → hand off to diagnose (see references/skill-handoff.md)"
```

## Debt Categories & Detection Tools

```yaml
detection_tools_first:
  code_debt:
    automated: ["ESLint", "Biome", "SonarQube", "jscpd (duplication)"]
    manual: "Code review for design issues"

  dependency_debt:
    automated: ["npm audit", "Dependabot", "Renovate", "pip-audit", "npm-check-updates"]
    manual: "License review, deprecation assessment"
    docs_required: true  # MUST query CHANGELOG before updating

  test_debt:
    automated: ["Coverage reports (c8, istanbul, pytest-cov)"]
    manual: "Test quality review, flaky test identification"

  architecture_debt:
    automated: ["Madge (circular deps)", "dependency-cruiser"]
    manual: "Architecture review, coupling analysis"

  infrastructure_debt:
    automated: ["CI/CD metrics, deployment frequency tracking"]
    manual: "Build time analysis, deployment friction assessment"

  documentation_debt:
    automated: ["`lore search` for gaps"]
    manual: "Onboarding feedback, support ticket analysis"
```

## Technical Debt Register Template

```markdown
# Technical Debt Register

## Summary
| Category | Count | Priority Items | Automated Fix Available |
|----------|-------|----------------|------------------------|
| Code | {n} | {n} | {yes/no} |
| Dependencies | {n} | {n} | {yes/no} |
| Tests | {n} | {n} | {yes/no} |
| Architecture | {n} | {n} | {yes/no} |

## High Priority Items

### TD-001: {Title}
- **Category**: {Code/Deps/Test/Arch/Infra/Docs}
- **Location**: {file/module}
- **Impact**: {why it matters}
- **Effort**: {estimated time}
- **Automated fix**: {tool name or "manual only"}
- **Docs consulted**: {yes/no — required for dependency items}
```

## GitHub Tracking

```yaml
github_integration:
  issue_write: "Create debt tracking issues with 'tech-debt' label"
  search_issues: "Find existing debt tickets before creating duplicates"
  create_pull_request: "Submit remediation PRs"
```
