# Mode: ddd - Domain-Driven Design Review

**Purpose**: Verify DDD tactical patterns and strategic boundaries in business code

## When to Use
- Auto-appended by mode-code when DDD project detected (lore ADRs/knowledge retros with DDD patterns, or DDD directories)
- Manually: /review ddd

## Supplementary References
- **OPTIONAL**: Read `references/oop-architecture-checklist.md` for SOLID baseline (already covered in mode-code)

## DDD Tactical Pattern Checklist

```yaml
aggregate:
  - "[ ] Aggregate root is the only entry point to the aggregate"
  - "[ ] Invariants are enforced within the aggregate boundary"
  - "[ ] Cross-aggregate references use IDs, not object references"
  - "[ ] Aggregate transactions are atomic (no multi-aggregate transactions)"
  - "[ ] Aggregate size is small (prefer fewer entities per aggregate)"

entity:
  - "[ ] Has identity (ID field, equality by ID)"
  - "[ ] Rich behavior (methods that enforce business rules, not just getters/setters)"
  - "[ ] State changes through intention-revealing methods (not direct property assignment)"
  - "[ ] Validates own invariants on construction and mutation"

value_object:
  - "[ ] Immutable (no setters, new instance on change)"
  - "[ ] Equality by value (not by reference/ID)"
  - "[ ] Self-validating on creation (invalid state is impossible)"
  - "[ ] Examples: Email, Money, Address, DateRange, Quantity"

repository:
  - "[ ] One repository per aggregate root (not per entity)"
  - "[ ] Interface defined in domain layer"
  - "[ ] Implementation in infrastructure layer"
  - "[ ] Returns domain objects (not ORM entities/raw rows)"
  - "[ ] Named with domain language (findActiveOrders, not selectWhereStatusEq1)"

domain_service:
  - "[ ] Contains logic that doesn't belong to a single entity"
  - "[ ] Stateless (no instance state between calls)"
  - "[ ] Named with ubiquitous language (TransferFundsService, not HelperService)"
  - "[ ] No infrastructure concerns (no DB, no HTTP)"

domain_event:
  - "[ ] Named as past-tense business fact (OrderPlaced, PaymentReceived)"
  - "[ ] Immutable payload (all data needed by consumers)"
  - "[ ] Published by aggregate root after state change"
  - "[ ] No side effects in the event itself"
```

## Layering Verification

```yaml
dependency_direction:
  allowed:
    - "presentation -> application -> domain"
    - "infrastructure -> domain (implements interfaces)"
  forbidden:
    - "domain -> infrastructure (BLOCKER)"
    - "domain -> presentation (BLOCKER)"
    - "application -> presentation (BLOCKER)"

  tool: "Use Serena find_referencing_symbols to trace cross-layer imports"

anti_corruption_layer:
  - "[ ] External system DTOs are NOT used in domain layer"
  - "[ ] Translation/mapping happens at the boundary"
  - "[ ] Domain model is not polluted by external concepts"
```

## Ubiquitous Language Check

```yaml
ubiquitous_language:
  - "[ ] Class/method names use domain language (not technical jargon)"
  - "[ ] Same concept has same name across code, docs, and conversations"
  - "[ ] No ambiguous terms used across bounded contexts without explicit mapping"
```

## Red Flags

```yaml
red_flags:
  anemic_domain:
    signal: "Entity has only properties + getters/setters; all logic in *Service classes"
    severity: MAJOR
    fix: "Move behavior into entity methods"

  smart_ui:
    signal: "Business rules embedded in controllers/components"
    severity: MAJOR
    fix: "Extract to domain service or entity method"

  repo_leak:
    signal: "Repository interface exposes ORM-specific types (Prisma types, QueryBuilder)"
    severity: MAJOR
    fix: "Return domain types, map in implementation"

  god_aggregate:
    signal: "Single aggregate with 10+ entities, 500+ lines"
    severity: MAJOR
    fix: "Split into smaller aggregates with clear boundaries"

  cross_aggregate_transaction:
    signal: "Single transaction modifying multiple aggregate roots"
    severity: MAJOR
    fix: "Use domain events for eventual consistency between aggregates"
```

## Primary Tools

```yaml
tools:
  code_understanding:
    - serena: find_symbol, find_referencing_symbols, get_symbols_overview (trace layer violations)
  domain_context:
    - lore: `lore search "<q>" --type adr --json`; `lore search "<q>" --type knowledge --json` for retros (load bounded context map if exists)
```

## Output Format

Same as mode-code but with DDD-specific categories in the findings table.

---

## §1 Layer Violation Detection

Tool-guided procedure to detect forbidden cross-layer imports in changed files.

```yaml
procedure:
  step_1:
    action: get_symbols_overview
    target: each changed file
    purpose: identify all import statements and top-level dependencies
    serena_call: "get_symbols_overview(relative_path='<changed_file>')"

  step_2:
    action: classify_imports_by_layer
    classification:
      domain: "src/domain/**, entities/**, aggregates/**, value-objects/**"
      application: "src/application/**, use-cases/**, services/**"
      infrastructure: "src/infrastructure/**, db/**, orm/**, repositories/impl/**, http/**, queue/**"
      presentation: "src/presentation/**, controllers/**, handlers/**, routes/**"
    rule: "Assign each import to one layer based on path pattern"

  step_3:
    action: verify_dependency_direction
    forbidden_pairs:
      - from: domain
        to: [infrastructure, presentation]
        severity: BLOCKER
      - from: application
        to: [presentation]
        severity: BLOCKER
      - from: domain
        to: [application]
        severity: MAJOR
    serena_call: "find_referencing_symbols(symbol_name='<infra_symbol>', relative_path='<domain_dir>')"
    purpose: "Confirm whether domain files actually reference infra symbols"

  evidence_format: "file:line — import '<module>' violates domain→infra rule"
```

---

## §2 Aggregate Boundary Verification

Tool-guided procedure to verify aggregate boundary integrity in changed code.

```yaml
procedure:
  step_1:
    action: identify_aggregate_roots
    signals:
      - "class decorated with @AggregateRoot or extends AggregateRoot"
      - "class that has a corresponding Repository interface"
      - "class referenced directly by application services (not via ID)"
    serena_calls:
      - "find_symbol(name_path='*Repository', substring_matching=true) — list all repositories"
      - "find_symbol(name_path='*AggregateRoot*', substring_matching=true) — list explicit roots"
    purpose: "Build list of aggregate roots touched by the change"

  step_2:
    action: verify_cross_aggregate_references_use_ids
    check: "No field typed as another AggregateRoot class — only ID primitives or value objects"
    procedure:
      - "Use find_symbol to read each aggregate root's fields/properties"
      - "For each field, check if its type annotation matches another aggregate root class name"
      - "Acceptable: primitive ID types (string, number, UUID), branded ID types (*Id), value objects"
      - "Violation: field typed as another AggregateRoot class directly (object reference instead of ID)"
    serena_calls:
      - "find_symbol(name_path='<AggregateRoot>', include_body=true) — inspect field type annotations"
      - "get_symbols_overview(relative_path='<domain_dir>') — cross-reference type names against known aggregate roots"
    evidence_format: "file:line — field '<name>: <AggregateType>' should be '<name>: <AggregateType>Id'"

  step_3:
    action: verify_no_multi_aggregate_transactions
    check: "No single transaction/unit-of-work saving multiple aggregate root types"
    serena_calls:
      - "search_for_pattern(pattern='(save|persist|commit).*\\n.*(save|persist|commit)', relative_path='<application_dir>', multiline=true)"
      - "find_referencing_symbols to confirm both saves are in the same transaction scope"
    evidence_format: "file:line — saves AggregateA and AggregateB in same transaction"
```

---

## §3 Domain Logic Leak Detection

Tool-guided procedure to find business logic outside the domain layer and infra concerns inside it.

```yaml
procedure:
  step_1:
    action: find_business_rules_in_controllers
    rationale: "Controllers should delegate; business rules belong in domain or application"
    serena_call: "search_for_pattern(pattern='if\\s*\\(|switch\\s*\\(', relative_path='<controllers_or_handlers_dir>')"
    filter: "Flag if/switch blocks that reference domain concepts (status, type, role) rather than HTTP concerns"
    evidence_format: "file:line — business rule if/switch in controller: '<snippet>'"

  step_2:
    action: find_infrastructure_imports_in_domain
    rationale: "Domain must be infrastructure-free"
    serena_calls:
      - "search_for_pattern(pattern='import.*prisma|import.*typeorm|import.*sequelize|import.*mongoose', relative_path='<domain_dir>')"
      - "search_for_pattern(pattern='import.*axios|import.*fetch|import.*http', relative_path='<domain_dir>')"
      - "search_for_pattern(pattern='import.*amqp|import.*kafka|import.*bull', relative_path='<domain_dir>')"
    evidence_format: "file:line — infra import '<module>' found in domain layer"

  step_3:
    action: check_repository_return_types
    rationale: "Repositories must return domain objects, not ORM entities"
    serena_calls:
      - "find_symbol(name_path='*Repository*', substring_matching=true) — list repository implementations"
      - "get_symbols_overview on each repository impl — inspect method return type annotations"
    red_flags:
      - "Return type is an ORM model class (e.g., PrismaUser, TypeOrmOrder)"
      - "Return type is 'any' or raw DB row shape"
    evidence_format: "file:line — repository method '<name>' returns ORM type '<type>' instead of domain type"
```

---

## Exit Criteria

```yaml
ddd_exit_gates:
  layer_verified: "All cross-layer imports in changed code checked"
  aggregates_verified: "Aggregate boundaries verified (if aggregates changed)"
  leak_checked: "No business logic in infra/presentation, no infra in domain"
  evidence: "Every finding cites file:line with Serena trace"
```
