# Aggregate Design Guide

**Purpose**: Define aggregate boundaries, invariant protection, and consistency rules following DDD tactical patterns.

## Core Principles

1. **Aggregate = Consistency Boundary = Transaction Boundary** — One aggregate is modified per transaction. No transaction spans multiple aggregates.
2. **Aggregate Root = Single Entry Point** — All external access to aggregate internals goes through the root entity. No direct manipulation of child entities.
3. **Reference by ID** — Aggregates reference other aggregates by identity (ID), never by direct object reference. This enforces boundary separation.
4. **Protect Invariants** — The aggregate root is responsible for enforcing all business rules (invariants) that span its internal entities.
5. **Prefer Small Aggregates** — Smaller aggregates = less contention, better scalability, simpler reasoning. Only group entities when invariant protection requires it.

## Aggregate Identification Workflow

### Step 1: Start from Event Storm Clusters

Use the aggregate candidates from Event Storming (Step 5). For each candidate:

```
serena: find_symbol → candidate root entity
serena: get_symbols_overview → internal entities, value objects
serena: find_referencing_symbols → who modifies these entities?
```

### Step 2: Invariant Analysis

For each candidate aggregate, identify business invariants:

| Invariant | Entities Involved | Must Be Atomic? | Example |
|-----------|-------------------|-----------------|---------|
| `{rule}` | `{entity list}` | YES/NO | "Order total must equal sum of line items" |

**If an invariant spans two entities → they likely belong in the same aggregate.**
**If no invariant spans two entities → they should be separate aggregates.**

Code signals for invariants:
```
serena: search_for_pattern → validation logic, guard clauses, assert statements
serena: search_for_pattern → transaction boundaries (@Transactional, BEGIN/COMMIT)
Grep: "throw.*Error", "throw.*Exception" near entity modifications
```

### Step 3: Boundary Sizing

Apply the **"Contention vs Invariant" test**:

| Question | YES → | NO → |
|----------|-------|------|
| Must these entities change atomically for invariant protection? | Same aggregate | Separate aggregates |
| Will concurrent users frequently modify both entities? | Consider splitting (contention risk) | Grouping is safe |
| Can the invariant be relaxed to eventual consistency? | Separate aggregates + domain event | Keep in same aggregate |
| Does the entity have its own lifecycle (create/delete independently)? | Separate aggregate | Child of current aggregate |

### Step 4: Entity vs Value Object Classification

Within each aggregate, classify internal components:

| Characteristic | Entity | Value Object |
|----------------|--------|--------------|
| Has identity? | YES — tracked by ID across time | NO — defined by attributes only |
| Mutable? | YES — state changes over lifecycle | NO — immutable (replace, don't modify) |
| Equality | By ID | By value (all fields equal) |
| Lifecycle | Independent creation, modification, deletion | Created and discarded with owner |
| Examples | `User`, `Order`, `Product` | `Address`, `Money`, `DateRange`, `Email` |

Code signals:
```
serena: search_for_pattern → classes/interfaces with `id` field → likely Entity
serena: search_for_pattern → classes with only readonly/final fields, equals() by value → likely VO
serena: search_for_pattern → embedded/nested types without own repository → likely VO
```

## Cross-Aggregate Consistency

When business processes span multiple aggregates, choose a consistency strategy:

### Decision Framework

| Criterion | Strong Consistency (same transaction) | Eventual Consistency (domain events) |
|-----------|--------------------------------------|--------------------------------------|
| Invariant criticality | Financial, safety-critical | Business convenience, reporting |
| Failure tolerance | Zero tolerance for inconsistency | Brief inconsistency acceptable |
| Performance need | Low throughput acceptable | High throughput required |
| Aggregate coupling | Acceptable to couple | Must remain independent |

### Eventual Consistency Patterns

1. **Domain Event + Handler**: Aggregate A emits event → Handler updates Aggregate B
2. **Saga / Process Manager**: Orchestrates multi-step process across aggregates with compensation
3. **Outbox Pattern**: Event stored in same transaction as aggregate change, then published

### Compensation Rules

When eventual consistency is chosen, define for each cross-aggregate interaction:
- **Happy path**: A succeeds → event → B succeeds
- **Compensation**: A succeeds → event → B fails → compensating event → A rolls back
- **Timeout**: A succeeds → event → B no response → alert/retry policy

## Aggregate Documentation Template

For each aggregate in `docs/domain/{domain}/aggregates.md`:

```markdown
## Aggregate: {Name}

**Root Entity**: {EntityName}
**Internal Entities**: {list}
**Value Objects**: {list}

### Invariants
| ID | Rule | Enforcement | Violation Error |
|----|------|-------------|-----------------|
| INV-{DOMAIN}-001 | {Business rule in natural language} | {Code location} | {Error code} |

### Commands (accepted by this aggregate)
| Command | Preconditions | Events Emitted | Side Effects |
|---------|---------------|----------------|--------------|

### Cross-Aggregate References
| Target Aggregate | Reference Type | Consistency | Pattern |
|-----------------|----------------|-------------|---------|
| {name} | by ID | eventual | domain event |

### Lifecycle
{State machine or lifecycle description}
```

## Anti-Patterns to Flag

| Anti-Pattern | Signal | Fix |
|--------------|--------|-----|
| **God Aggregate** | 10+ entities, 20+ fields on root | Split by invariant analysis |
| **Anemic Aggregate** | Root has only getters, logic in services | Move business rules into aggregate |
| **Cross-Aggregate Transaction** | Single DB transaction modifies 2+ aggregate roots | Introduce domain events |
| **Direct Object Reference** | Aggregate holds reference to another aggregate's entity object | Replace with ID reference |
| **Invariant Leak** | Business rule enforced in application service, not aggregate | Move validation into aggregate root |
| **Missing Aggregate Root** | Child entities modified directly bypassing parent | Enforce access through root only |
