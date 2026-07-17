# OOP & Architecture Quick Reference

## SOLID Principles — Review Heuristics

```yaml
solid_principles:

  SRP:
    question: "If I describe what this class does, do I use the word 'and'?"
    violation_signal: "Class handles parsing AND validation AND persistence"
    check:
      - [ ] Each class/module has a single, well-defined reason to change
      - [ ] Class description fits in one sentence without 'and'
      - [ ] File length is reasonable (< 300 lines is a good heuristic)
      - [ ] Constructor doesn't inject unrelated dependencies
    severity: "→ MAJOR (classes with multiple responsibilities are the #1 source of cascading changes)"

  OCP:
    question: "Can I add new behavior without modifying this code?"
    violation_signal: "switch/case on type that grows with every new variant"
    check:
      - [ ] New variants can be added without touching existing code
      - [ ] No switch/case or if/else chain that must grow with every new type
      - [ ] Extension points exist where change is expected (hooks, strategies, plugins)
      - [ ] Configuration-driven behavior where appropriate
    severity: "→ MINOR (unless high-change area where new variants are added frequently, then MAJOR)"

  LSP:
    question: "Can I replace parent with child without surprises?"
    violation_signal: "Subclass throws NotImplemented, narrows preconditions, or breaks postconditions"
    check:
      - [ ] Subclass does not throw NotImplementedError for inherited methods
      - [ ] Subclass does not add preconditions (stricter input requirements)
      - [ ] Subclass does not weaken postconditions (looser output guarantees)
      - [ ] Subclass does not violate invariants established by parent
      - [ ] instanceof checks or type guards for subclass-specific behavior are absent
    severity: "→ MAJOR (LSP violations cause runtime surprises and break polymorphic code)"

  ISP:
    question: "Does the consumer use all methods of this interface?"
    violation_signal: "Interface with 10 methods, most implementors throw NotImplemented for half"
    check:
      - [ ] No interface forces implementors to provide unused methods
      - [ ] Consumers depend only on the methods they actually call
      - [ ] Fat interfaces are decomposed into focused, role-based contracts
      - [ ] No empty/stub implementations to satisfy an over-broad interface
    severity: "→ MINOR (unless multiple implementors are forced into stub methods, then MAJOR)"

  DIP:
    question: "Does high-level policy depend on low-level detail?"
    violation_signal: "Service directly instantiates PostgresRepository instead of depending on RepositoryInterface"
    check:
      - [ ] High-level modules import interfaces/abstractions, not concrete classes
      - [ ] Concrete dependencies are injected (constructor, factory, or DI container)
      - [ ] No direct instantiation of infrastructure classes inside domain/business logic
      - [ ] Module boundaries are defined by abstractions, not implementations
    severity: "→ MAJOR (tight coupling to implementations makes testing and swapping impossible)"
```

## Architecture Smells

```yaml
architecture_smells:

  anemic_domain_model:
    detection: "Entity with only data (getters/setters), Service class contains all business logic"
    severity: "→ MAJOR"
    check:
      - [ ] Domain entities contain business logic, not just properties
      - [ ] Service layer orchestrates, not implements, domain rules

  feature_envy:
    detection: "Method accesses another object's data more than its own"
    severity: "→ MINOR"
    check:
      - [ ] Methods primarily operate on their own object's data
      - [ ] No long chains of getters into another object's internals

  primitive_obsession:
    detection: "String/number used where a domain type fits (email, money, coordinates)"
    severity: "→ MINOR"
    check:
      - [ ] Domain concepts are modeled as types, not raw primitives
      - [ ] Validation logic is encapsulated in the value object, not scattered

  circular_dependency:
    detection: "A → B → A (direct or transitive cycle between modules)"
    severity: "→ BLOCKER"
    fix: "Extract shared interface or mediator; invert one edge of the cycle via DIP"
    check:
      - [ ] No import cycles between modules
      - [ ] Dependency graph is a DAG (directed acyclic graph)

  shotgun_surgery:
    detection: "One logical change requires touching 10+ files across multiple modules"
    severity: "→ MAJOR"
    check:
      - [ ] Related logic is colocated
      - [ ] Changes to one business rule don't ripple across many files

  god_object:
    detection: "One class/module does everything — hundreds of methods, thousands of lines"
    severity: "→ MAJOR"
    check:
      - [ ] No single class exceeds ~300 lines or ~10 public methods
      - [ ] Class name does not contain vague words like 'Manager', 'Handler', 'Utils', 'Helper'

  leaky_abstraction:
    detection: "Caller must know implementation details to use the API correctly"
    severity: "→ MINOR"
    check:
      - [ ] Consumers don't need to understand internal data structures or formats
      - [ ] Error types are domain-level, not infrastructure-level (no raw SQL errors leaking)

  inappropriate_intimacy:
    detection: "Two classes access each other's private/internal state excessively"
    severity: "→ MAJOR"
    check:
      - [ ] Classes interact through public interfaces, not internal fields
      - [ ] No friend/package-private access used to bypass encapsulation

  speculative_generality:
    detection: "Abstract classes/interfaces that exist 'just in case' with only one implementation"
    severity: "→ MINOR"
    check:
      - [ ] Every abstraction has at least two real implementations or a clear extension point rationale
      - [ ] No unused type parameters, empty abstract methods, or hooks with a single consumer
```

## Review Workflow

```yaml
review_order:
  1_scan_for_smells:
    action: "Scan changed files for architecture smells listed above"
    priority: "BLOCKER smells first (Circular Dependency), then MAJOR, then MINOR"

  2_check_solid:
    action: "For each class/interface in the diff, run the 5 SOLID diagnostic questions"
    focus: "New classes and significantly modified classes"

  3_verify_boundaries:
    check:
      - [ ] Dependencies flow inward (domain has zero external dependencies)
      - [ ] No circular imports between modules
      - [ ] Infrastructure details don't leak into domain/application layer

  4_assess_testability:
    check:
      - [ ] Dependencies are injectable (no hidden singletons or global state)
      - [ ] Side effects are isolated and mockable
      - [ ] Pure business logic can be tested without infrastructure

severity_guide:
  BLOCKER: "Must fix before merge — architectural corruption"
  MAJOR: "Should fix before merge — significant design debt"
  MINOR: "Nice to fix — improvement opportunity, can be tracked as follow-up"
```
