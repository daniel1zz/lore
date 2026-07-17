# Migration Patterns Reference

> Strategy selection guide only. For technology-specific migration steps, **always query official docs** via context7/gitmcp/mcp-deepwiki.

## Strategy Decision Tree

```yaml
decision_tree:
  can_afford_downtime:
    yes:
      risk_tolerance_high:
        yes: "Big Bang Migration"
        no: "Parallel Run → Cutover"
    no:
      replacing_internal_implementation:
        yes: "Branch by Abstraction"
        no:
          replacing_external_system:
            yes: "Strangler Fig"
            no: "Expand-Contract (Parallel Change)"
```

## Strategy Summary

| Strategy | Best For | Risk | Complexity |
|----------|----------|------|------------|
| Strangler Fig | Large legacy → new system | Low | High |
| Branch by Abstraction | Swapping internal implementation | Low | Medium |
| Parallel Run | High-risk, correctness-critical | Very Low | High |
| Expand-Contract | API/schema changes, zero-downtime | Low | Medium |
| Big Bang | Small scope, can afford downtime | High | Low |

### Strangler Fig
- Build new system around old, gradually route traffic
- Phases: Facade → Incremental build → Traffic shift → Legacy removal
- Use when: Large legacy systems, cannot afford downtime

### Branch by Abstraction
- Introduce abstraction layer, swap implementation behind it
- Phases: Create interface → Wrap existing → Build new → Switch → Remove old
- Use when: Replacing libraries/frameworks, internal implementation changes

### Parallel Run
- Run both systems, compare results, validate before switching
- Phases: Shadow mode → Verification → Cutover → Cleanup
- Use when: High-risk migrations, complex business logic, correctness-critical

### Expand-Contract
- Add new alongside old → migrate consumers → remove old
- Phases: Expand → Migrate → Contract
- Use when: API changes, DB schema changes, zero-downtime requirements

## Mandatory Documentation Lookup

⚠️ **Before any technology migration, you MUST**:

```yaml
docs_lookup:
  1_official_upgrade_guide:
    tools: [context7, gitmcp]
    queries:
      - "{framework} upgrade from {source} to {target}"
      - "{framework} migration guide {target_version}"
      - "{framework} breaking changes {target_version}"

  2_official_codemods:
    tools: [context7, gitmcp]
    queries:
      - "{framework} codemod"
      - "{framework} migration CLI tool"
    examples:
      - "npx @next/codemod@latest"
      - "npx vue-codemod"
      - "npx @angular/cli update"
      - "npx react-codemod"
      - "npx ts-migrate"

  3_changelog_review:
    tools: [gitmcp]
    queries:
      - "CHANGELOG.md in {framework} repo"
      - "MIGRATION.md or UPGRADE.md"
      - "breaking" in release notes

  4_ecosystem_compatibility:
    action: "Check that related libraries support target version"
    tools: [context7]
```

> **Rule**: Never hardcode migration steps. Always query latest official docs — frameworks evolve rapidly.

## Migration Checklist

```yaml
before: [System documented, Integration points mapped, Tests adequate, Rollback plan defined, Success criteria defined]
during: [Incremental changes, Continuous verification, Stakeholder communication, Progress tracking]
after: [All functionality verified, Performance baseline met, No error increase, Docs updated, Old system decommissioned]
```
