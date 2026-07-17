# Context Mapping — Patterns, Detection, and Documentation

**Purpose**: Map relationships between bounded contexts using DDD strategic patterns. Determine upstream/downstream dynamics, integration strategies, and team autonomy boundaries.

## Context Mapping Patterns

### Pattern Catalog

| Pattern | Relationship | When to Use | Code Signals |
|---------|-------------|-------------|--------------|
| **Partnership** | Mutual, symmetric | Two teams co-evolve, aligned schedules, shared success | Joint PRs, synchronized releases, shared test suites |
| **Shared Kernel** | Shared subset | Small shared model both teams agree on | Shared library/package, common types, co-owned module |
| **Customer-Supplier** | Upstream serves downstream | Upstream provides, downstream consumes; upstream plans for downstream needs | API provider → consumer, event producer → subscriber |
| **Conformist** | Downstream conforms to upstream | Downstream adopts upstream's model as-is, no translation | Direct use of upstream types/DTOs, no mapping layer |
| **Anti-Corruption Layer (ACL)** | Downstream isolates from upstream | Downstream translates upstream model to own language | Adapter/translator classes, mapping functions, facade |
| **Open Host Service (OHS)** | Upstream provides clean API | Upstream exposes well-defined protocol for multiple consumers | Public REST/GraphQL API, SDK, documented contract |
| **Published Language (PL)** | Shared interchange format | Standard format both parties understand | JSON Schema, Protobuf, OpenAPI spec, industry standard (HL7, FIX) |
| **Separate Ways** | No integration | Cost of integration > benefit | Independent systems, manual data entry, copy-paste workflows |
| **Big Ball of Mud** | (anti-pattern) | Legacy system with no clear boundaries | Monolith, circular dependencies, shared mutable state |

### Pattern Selection Decision Tree

```
Q1: Do both teams need to change the shared model?
  YES → Q2: Can they coordinate release schedules?
    YES → Partnership
    NO  → Q3: Is the shared part small and stable?
      YES → Shared Kernel
      NO  → Customer-Supplier (negotiate who leads)
  NO → Q4: Who owns the model?
    Upstream owns → Q5: Does downstream need its own model?
      YES → Anti-Corruption Layer
      NO  → Q6: Is upstream's model acceptable as-is?
        YES → Conformist
        NO  → ACL (must translate)
    Multiple consumers → Open Host Service + Published Language
    No one wants to integrate → Separate Ways
```

## Detection from Code

### Step 1: Identify Bounded Contexts

Sources for context boundaries:
```
serena: list_dir → top-level module/package structure
serena: search_for_pattern → namespace/package declarations
Grep: import statements crossing module boundaries
Event Storming: pivotal events mark boundary candidates
```

Boundary signals (strong → weak):
1. **Separate deployable** (microservice) — definitive boundary
2. **Separate database/schema** — strong boundary
3. **Separate module with clear API** — moderate boundary
4. **Separate directory with cross-imports** — weak boundary (may need strengthening)
5. **Same directory, different naming conventions** — implicit boundary (needs extraction)

### Step 2: Map Relationships

For each pair of interacting contexts:

```
serena: search_for_pattern → imports from context A in context B (and vice versa)
serena: find_referencing_symbols → cross-context symbol usage
Grep: HTTP/RPC calls between services
Grep: event pub/sub across context boundaries
Grep: shared database table access from multiple contexts
```

### Step 3: Classify Each Relationship

For each cross-context interaction, determine:

| Question | Answer → Pattern |
|----------|-----------------|
| Direction of dependency? | A→B, B→A, or bidirectional |
| Who can change the shared interface? | Both (Partnership/Shared Kernel) or one side (Customer-Supplier) |
| Is there a translation layer? | YES → ACL; NO → Conformist or direct coupling |
| Is the upstream API designed for multiple consumers? | YES → OHS+PL; NO → point-to-point |
| Is the integration worth maintaining? | NO → Separate Ways |

### Step 4: Detect Upstream/Downstream

The **upstream** context:
- Defines the model/API/event schema
- Can change without asking permission
- Is depended upon

The **downstream** context:
- Consumes/adapts the upstream model
- Must react to upstream changes
- Depends on upstream

Code signals for direction:
- `import` direction: importing context is downstream
- API provider vs consumer: provider is upstream
- Event producer vs subscriber: producer is upstream
- Schema owner vs schema consumer: owner is upstream

## Context Map Documentation

### Map Visualization Format

```markdown
## Context Map: {System Name}

[Context A] <--(Partnership)--> [Context B]
[Context C] --(Customer-Supplier)--> [Context D]
                                        |
                                       ACL
                                        |
                                    [Context E]
[Context F] ~~(Separate Ways)~~ [Context G]
```

### Relationship Detail Template

For each relationship in `docs/domain/DOMAIN-MAP.md`:

```markdown
### {Context A} ↔ {Context B}

| Attribute | Value |
|-----------|-------|
| Pattern | {pattern name} |
| Direction | A → B (upstream → downstream) |
| Integration | {sync API / async event / shared DB / file transfer} |
| Shared Model | {types/events/schemas shared} |
| Translation | {ACL class/adapter location, or "none (conformist)"} |
| Team Ownership | A: {team}, B: {team} |
| Change Protocol | {who approves interface changes} |
| Failure Mode | {what happens when integration fails} |
```

## Strategic Domain Classification

Every bounded context must be classified to guide investment decisions:

### Classification Taxonomy

| Type | Definition | Investment Strategy | Build vs Buy |
|------|-----------|--------------------:|--------------|
| **Core Domain** | Competitive advantage. What makes this business unique. | **Highest** — best engineers, most testing, deepest modeling | Always BUILD custom |
| **Supporting Domain** | Necessary for core to function, but not differentiating | **Medium** — good enough, pragmatic | Build simple OR buy if close fit |
| **Generic Domain** | Commodity capability, same across industries | **Minimal** — use off-the-shelf | Always BUY / use SaaS / open-source |

### Classification Criteria

| Signal | Core | Supporting | Generic |
|--------|------|-----------|---------|
| Business uniqueness | Only we do this | We need it but competitors do too | Everyone needs this |
| Domain complexity | High — deep rules, many edge cases | Medium — moderate rules | Low — well-understood |
| Change frequency | High — evolves with business | Medium — changes occasionally | Low — stable/commodity |
| Competitive impact | Direct revenue/differentiation | Enables core but doesn't differentiate | No competitive impact |
| Expert availability | Rare, expensive domain experts | Available but specific | Common knowledge |

### Classification Output

Add to `docs/domain/DOMAIN-MAP.md`:

```markdown
## Strategic Classification

| Bounded Context | Type | Rationale | Investment | Build/Buy |
|----------------|------|-----------|------------|-----------|
| Order Management | Core | Unique fulfillment rules | High — dedicated team | Build |
| User Auth | Generic | Standard OAuth/RBAC | Minimal | Buy (Auth0/Clerk) |
| Notification | Supporting | Standard but customized templates | Medium | Build simple |
```

### Classification Drives Downstream Decisions

| Decision | Core Domain | Supporting Domain | Generic Domain |
|----------|------------|-------------------|----------------|
| Testing depth | Extensive (unit+integration+E2E+property) | Standard (unit+integration) | Minimal (smoke tests) |
| Code quality | Highest — DDD tactical patterns, rich model | Good — pragmatic patterns | Acceptable — thin wrapper |
| Documentation | Deep domain docs, expert lenses, scenarios | Standard docs | API reference only |
| Team allocation | Senior/domain experts | Mixed | Junior OK / outsource |
| Refactoring priority | First — invest in model accuracy | Second — simplify when needed | Last — replace before refactor |

## Anti-Patterns to Flag

| Anti-Pattern | Signal | Fix |
|--------------|--------|-----|
| **Core treated as Generic** | Competitive logic using off-the-shelf with workarounds | Invest in custom model |
| **Generic treated as Core** | Commodity functionality (auth, email) built from scratch | Replace with SaaS/library |
| **Missing ACL** | Downstream directly uses upstream's internal types | Introduce translation layer |
| **Shared Database** | Multiple contexts read/write same tables | Split schemas, use events |
| **Cyclic Dependencies** | A depends on B depends on A | Introduce mediator or merge contexts |
| **Too Many Shared Kernels** | >2 contexts sharing same model | Evolve to OHS+PL or split kernel |
