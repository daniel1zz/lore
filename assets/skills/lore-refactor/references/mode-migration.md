# Mode: migration

**Purpose**: Technology and platform migrations

## Migration Types & Approaches

| Type | Approach |
|------|----------|
| Framework (React 17→18, Vue 2→3) | Incremental adoption |
| Language (JS→TS, Python 2→3) | Gradual migration |
| Database (MySQL→PG, SQL→NoSQL) | Dual-write, shadow reads, cutover |
| Infrastructure (Heroku→K8s) | Parallel deployment, traffic shifting |

## Strategies

- **Strangler Fig**: new alongside old → route new traffic → migrate existing → remove old
- **Branch by Abstraction**: abstract interface → new implementation → switch → remove old
- **Parallel Change**: expand (add new) → migrate (move consumers) → contract (remove old)

## Workflow

1. **Assess**: inventory usage, dependencies, integration points (serena: search_for_pattern, find_referencing_symbols)
2. **Plan**: choose strategy, define milestones, plan rollback
3. **Docs Lookup** (MANDATORY for version/tech changes):
   - context7 (P1): `{framework} {version} upgrade guide / breaking changes`
   - gitmcp (P2): search CHANGELOG/MIGRATION/UPGRADE.md, "breaking" in release notes
   - mcp-deepwiki (P3): migration questions
   - Extract: API changes, new requirements, removed features, renamed exports, config changes
   - Integrate into migration plan
4. **Prepare**: new environment, compatibility layer, feature flags
5. **Migrate incrementally**: component by component, verify each step
6. **Cutover & cleanup**: final migration, remove old code, update docs

## Migration Plan Template

```markdown
# Migration: {From} → {To}
## Overview: current, target, timeline, strategy
## Impact: | Component | Impact | Effort | Priority |
## Official Migration Reference
### Breaking Changes: | Change | Impact | Action |
### Deprecated APIs: | Old | New | Notes |
## Phases: Setup → Pilot → Incremental → Cutover
## Rollback: trigger conditions + steps
## Success Criteria: functionality, performance, errors, training
```
