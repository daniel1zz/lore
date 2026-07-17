# Domain Documentation Templates

## Directory Structure

```
docs/domain/{domain}/
├── README.md              # Overview (always loaded on activation)
├── entities.md            # Entity definitions (on demand)
├── aggregates.md          # Aggregate boundaries, invariants, consistency rules (on demand)
├── rules.md               # Business rules (on demand)
├── workflows.md           # Business processes (on demand)
├── glossary.md            # Ubiquitous Language glossary (on demand)
├── event-storm.md         # Event Storming results (on demand)
├── codebase.md            # Code locations (on demand)
├── expert-lenses.md       # Role-based evaluation frameworks (auto-loaded by Doc Routing)
├── business-scenarios.md  # Scenario-based evaluation frameworks (auto-loaded by Doc Routing)
└── index.yaml             # Metadata for tooling
```

## index.yaml Schema

```yaml
domain: order                           # kebab-case
created: "2024-01-15"
updated: "2024-06-20"
owner: order-team
dependencies:
  - {domain: payment, type: "calls|events|data", description: "..."}
strategic_type: core | supporting | generic   # Strategic domain classification
files: {readme, entities, aggregates, rules, workflows, glossary, event-storm, codebase, expert-lenses, business-scenarios}
metrics: {entity_count, aggregate_count, rule_count, workflow_count, glossary_term_count}
# version/status/changelog managed by lore (version history on the registered knowledge doc) — do NOT duplicate
```

## Content Guidelines

| File | Target | Key Content |
|------|--------|-------------|
| README.md | ~300-500 lines | Frontmatter, quick reference table, scope (covers/not), strategic type (core/supporting/generic), cross-domain summary, navigation. NO detailed entities/rules/workflows/code. |
| entities.md | Complete | Per entity: TS interface, fields table, state machine, relationships, sample data |
| aggregates.md | Complete | Per aggregate: root entity, internals, invariants, commands, cross-aggregate refs, lifecycle. See [aggregate-design.md](../references/aggregate-design.md) |
| rules.md | Complete | Validation rules (table), state transitions, business rules (BR-{DOMAIN}-NNN), permission matrix, error codes |
| workflows.md | Complete | Per workflow: overview table, preconditions, flow diagram, step details, error handling, events published |
| glossary.md | Complete | Ubiquitous Language glossary: term, definition, code symbol, context scope, synonyms, anti-terms |
| event-storm.md | Complete | Event Storm results: event timeline, command-event-actor triples, policies, aggregate clusters, hotspots, pivotal events |
| codebase.md | Complete | Directory tree, key files index, method index, cross-domain imports, test mapping, "I want to..." nav |

## expert-lenses.md Schema

Per lens (3-5 per domain):

```markdown
## Lens: {Role Name} ({localized name})

**identity**: {Brief — who, experience, focus area}

**priorities** (ordered):
1. {Most important concern}
2. {Second concern}
3. {Third concern}

**checklist** (specific, actionable evaluation items):
- {Concrete check item with context — NOT vague "consider safety"}
- {Another specific item}

**red_flags** (danger signals in code/design):
- {Specific anti-pattern or mistake to catch}

**scenarios** (real usage situations with environmental context):
- {Concrete scenario: who, when, where, doing what, feeling what}
```

Key principle: **specificity over generality**. Each item must be concrete enough that two reviewers would independently flag the same issues. Bad: "consider user experience". Good: "can the user complete core input with one hand while holding a baby?"

## business-scenarios.md Schema

Per scenario (3-8 per domain, coarse-grained):

```markdown
## Scenario: {Scenario Name} ({localized name})

**trigger**: What event/condition activates this scenario
**context**: Environmental state — time, load, data volume, user emotional state, system state
**actors**: [role-1, role-2] (references to expert-lenses roles)
**happy_path**:
1. {Step with actor and action}
2. {Next step}

**edge_cases**:
- {Boundary condition → expected behavior}

**failure_modes**:
- {Failure mode → blast radius → recovery expectation}

**cross_cutting**:
- {Cross-domain/cross-service interaction point → consistency requirement}
```

### Scenario Dimensions (discovery framework)

| Dimension | What to look for | Examples |
|-----------|-----------------|----------|
| **Core flows** | Product main paths end-to-end | Register → Order → Pay → Fulfill → After-sales |
| **Lifecycle transitions** | State changes of users, data, or system | First-time user onboarding, account deletion, data expiration |
| **Peak & stress** | Abnormal scale or pressure conditions | Flash sale, traffic spike, bulk data migration |
| **Failure & recovery** | System behavior after faults | Payment timeout, partial rollback, retry storm |
| **Cross-domain** | Multi-domain coordination | Order → Inventory → Shipping consistency |
| **Compliance triggers** | Regulatory/policy-driven scenarios | GDPR deletion, minor access, cross-border data |

Key principle: scenarios are **coarse-grained business situations**, not test cases. Each scenario represents a real-world context that exercises multiple components and roles simultaneously.

## glossary.md Schema (Ubiquitous Language)

Per term (all significant domain terms):

```markdown
### {Term} ({localized name if applicable})

| Attribute | Value |
|-----------|-------|
| **Definition** | {Precise business definition in domain language} |
| **Code Symbol** | `{ClassName}`, `{methodName}`, `{ENUM_VALUE}` |
| **Context** | {Bounded context where this term applies} |
| **Synonyms** | {Other terms that mean the same thing — align on one} |
| **Anti-Terms** | {Terms that look similar but mean something different} |
| **Example** | {Concrete usage example} |
```

Key principles:
- **One term, one meaning per bounded context.** Same word can mean different things in different contexts (e.g., "Account" in billing vs auth).
- **Code must match glossary.** If glossary says "Order", code should use `Order` not `Purchase` or `Transaction`.
- **Flag mismatches**: document where code deviates from UL, with migration plan.

## aggregates.md Schema

See [aggregate-design.md](../references/aggregate-design.md) for the full aggregate documentation template. Summary:

Per aggregate:
- Root Entity, Internal Entities, Value Objects
- Invariants table (ID, Rule, Enforcement, Violation Error)
- Commands accepted + Events emitted
- Cross-Aggregate References (target, reference type, consistency, pattern)
- Lifecycle (state machine)

## Naming Conventions

| Item | Convention | Example |
|------|------------|---------|
| Domain dir | kebab-case | `docs/domain/order-management/` |
| Entity names | PascalCase | `Order`, `OrderItem` |
| Rule IDs | BR-{DOMAIN}-{NNN} | `BR-ORDER-001` |
| Invariant IDs | INV-{DOMAIN}-{NNN} | `INV-ORDER-001` |
| Aggregate names | PascalCase (root entity name) | `OrderAggregate` |
| Glossary terms | PascalCase (matching code symbol) | `OrderItem` |
| Error codes | {DOMAIN}_{NNN} | `ORDER_001` |
