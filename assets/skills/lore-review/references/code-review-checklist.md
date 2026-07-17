# Code Review Checklist

## SDK & Open Source Assessment

```yaml
checklist:
  reinventing_the_wheel:
    action: "Check if the code implements functionality that an established open-source SDK/library already provides"
    check:
      - [ ] Is the code doing HTTP client work? (axios, ky, ofetch, got)
      - [ ] Is the code doing date/time manipulation? (date-fns, dayjs, Temporal)
      - [ ] Is the code doing validation/parsing? (zod, valibot, arktype)
      - [ ] Is the code doing state management? (zustand, jotai, valtio)
      - [ ] Is the code doing data fetching/caching? (TanStack Query, SWR)
      - [ ] Is the code doing form handling? (react-hook-form, formik)
      - [ ] Is the code doing CLI arg parsing? (commander, yargs, citty)
      - [ ] Is the code doing file system operations? (fs-extra, globby)
      - [ ] Is the code doing auth/JWT/crypto? (jose, passport, lucia)
      - [ ] Is the code doing email/PDF/Excel generation? (resend, jspdf, exceljs)
      - [ ] Is the code doing queue/job processing? (bullmq, temporal)
      - [ ] Is the code implementing any well-known algorithm or data structure?
    tools: [WebSearch, context7, mcp-deepwiki, npm search]
    how: |
      1. Identify the DOMAIN of the hand-written code (e.g., retry logic, rate limiting, CSV parsing)
      2. Search for established libraries in that domain
      3. Evaluate: library maturity (stars, maintenance, downloads) vs hand-written complexity
      4. If a mature library exists → flag as MAJOR (reinventing the wheel)
    exceptions:
      - Trivial utilities (< 10 lines) where a library would be overkill
      - Domain-specific business logic with no generic library equivalent
      - Performance-critical hot paths where library overhead matters
      - Security-sensitive code where dependency supply chain risk outweighs convenience
    severity: "→ MAJOR (reinventing the wheel wastes effort and misses battle-tested edge cases)"

  sdk_best_practice:
    action: "For every open-source SDK/library used in changed code, verify usage follows official best practices"
    check:
      - [ ] API usage matches current version's recommended patterns (not deprecated API)
      - [ ] Configuration follows library's recommended defaults
      - [ ] Error handling follows library's documented patterns
      - [ ] No anti-patterns warned against in official docs
      - [ ] Using the library's built-in features instead of manual workarounds
      - [ ] Import style is optimal (tree-shaking friendly, no full-bundle imports)
    tools: [context7 resolve-library-id + query-docs, mcp-deepwiki ask_question]
    how: |
      1. List all third-party libraries referenced in changed files
      2. For each library: query official docs for best practices / recommended usage
      3. Compare actual usage against recommended patterns
      4. Flag deviations with specific doc references
    severity:
      deprecated_api: "→ MAJOR"
      anti_pattern: "→ MAJOR"
      suboptimal_usage: "→ MINOR"
      import_style: "→ NIT"
```

## Best Practice Compliance

```yaml
checklist:
  - [ ] No temporary fixes or workarounds when a proper solution exists
  - [ ] No unnecessary backward-compatibility shims (deprecated aliases, compat layers, adapters)
  - [ ] Uses best-practice patterns, not "safe" incremental approaches
  - [ ] Breaking changes are made directly — no preservation of old interfaces unless user-requested
  - [ ] No "for now" or "TODO: migrate later" patterns that defer proper implementation

red_flags:
  compat_shim: "Adding an adapter/wrapper to avoid changing call sites → just change call sites"
  deferred_fix: "'// TODO: refactor later' or '// temporary workaround' → fix it now"
  incremental_hack: "Patching around a broken API instead of fixing the API itself"
  over_cautious: "Keeping deprecated exports 'just in case' → delete them"

severity:
  temporary_fix_when_proper_solution_exists: "→ MAJOR"
  unnecessary_compat_layer: "→ MAJOR"
  deferred_todo_for_known_fix: "→ MINOR"
```

## General Quality

### Logic & Correctness

```yaml
checklist:
  - [ ] Code does what the PR description says
  - [ ] Edge cases are handled
  - [ ] No off-by-one errors
  - [ ] Null/undefined values handled properly
  - [ ] Race conditions addressed
  - [ ] Resource cleanup (close connections, clear timers)
  - [ ] Error paths don't leave invalid state
```

### Error Handling

```yaml
checklist:
  - [ ] Errors are caught and handled appropriately
  - [ ] Error messages are helpful (not generic)
  - [ ] Errors don't expose sensitive information
  - [ ] Failed operations don't leave partial state
  - [ ] Async errors are caught (not just sync)
  - [ ] User-facing errors are friendly
```

### Code Organization

```yaml
checklist:
  - [ ] Functions do one thing (single responsibility)
  - [ ] Functions are at appropriate length (< 50 lines)
  - [ ] Nesting is minimal (< 3 levels)
  - [ ] Related code is grouped together
  - [ ] No duplicate code (DRY)
  - [ ] Abstractions are at the right level
```

### Architecture & OOP Principles

> See also: `references/oop-architecture-checklist.md` for detailed SOLID heuristics and architecture smell catalog.

```yaml
checklist:
  solid:
    - [ ] SRP: Each class/module has a single reason to change
    - [ ] OCP: New behavior added via extension, not modification of existing code
    - [ ] LSP: Subtypes are substitutable for their base types without breaking callers
    - [ ] ISP: No client is forced to depend on methods it doesn't use
    - [ ] DIP: High-level modules depend on abstractions, not concrete implementations

  layer_violations:
    - [ ] No upward dependency (infra → domain is forbidden)
    - [ ] No cross-cutting shortcuts (controller calling repository directly, bypassing service)
    - [ ] Side effects (DB, HTTP, file I/O) isolated from pure business logic

  design_smells:
    anemic_model: "Entity/class with only getters/setters, all logic in external service → MAJOR"
    leaky_abstraction: "Implementation detail exposed through public API → MINOR"
    circular_dependency: "Module A → B → A → BLOCKER"
    primitive_obsession: "Using string/number where a domain type (Email, Money, UserId) would be safer → MINOR"
    god_object: "One class/module handles everything → MAJOR"

severity:
  layer_violation: "→ BLOCKER (architectural erosion)"
  solid_violation_clear: "→ MAJOR"
  design_smell: "→ MINOR"
```

### Naming

```yaml
checklist:
  - [ ] Names are descriptive and intention-revealing
  - [ ] Naming follows project conventions
  - [ ] No misleading names
  - [ ] Abbreviations are well-known or avoided
  - [ ] Boolean variables read as questions

conventions:
  functions: "camelCase, verb + noun"
  classes: "PascalCase, noun"
  constants: "UPPER_SNAKE_CASE"
  private: "_prefix or #private"
  booleans: "is/has/can/should prefix"
```

## TypeScript/JavaScript Specific

### Type Safety

```yaml
checklist:
  - [ ] No 'any' types (use 'unknown' if needed)
  - [ ] Type assertions are justified
  - [ ] Generics used appropriately
  - [ ] Union types handled exhaustively
  - [ ] Null/undefined in types matches runtime
```

### Modern JavaScript

```yaml
checklist:
  - [ ] Using const/let appropriately (prefer const)
  - [ ] Arrow functions used consistently
  - [ ] Destructuring where it improves readability
  - [ ] Template literals for string interpolation
  - [ ] Optional chaining (?.) and nullish coalescing (??)
  - [ ] Async/await instead of callbacks/raw promises
```

## React Specific

### Component Design

```yaml
checklist:
  - [ ] Components are focused (single responsibility)
  - [ ] Props interface is well-defined
  - [ ] Default props provided where appropriate
  - [ ] Component is reusable (not overly specific)
  - [ ] UI and logic separated appropriately
```

### Hooks Usage

```yaml
checklist:
  - [ ] Hooks at top level (not in conditions/loops)
  - [ ] Dependencies arrays are correct
  - [ ] useEffect cleanup functions provided
  - [ ] useMemo/useCallback used appropriately
  - [ ] Custom hooks extract reusable logic
```

### State Management

```yaml
checklist:
  - [ ] State is at the appropriate level
  - [ ] Derived state computed, not stored
  - [ ] State updates are batched when possible
  - [ ] Complex state uses useReducer
  - [ ] Global state only when necessary
```

## Performance

### General

```yaml
checklist:
  - [ ] No N+1 queries
  - [ ] Database queries are indexed
  - [ ] Large datasets are paginated
  - [ ] Expensive operations are cached
  - [ ] No blocking operations on main thread
```

### Frontend

```yaml
checklist:
  - [ ] No unnecessary re-renders
  - [ ] Large lists are virtualized
  - [ ] Images are optimized (lazy load, sizing)
  - [ ] Bundle size impact considered
  - [ ] Expensive calculations memoized
```

## Testing

### Coverage

```yaml
checklist:
  - [ ] New code has tests
  - [ ] Edge cases are tested
  - [ ] Error paths are tested
  - [ ] Integration points are tested
  - [ ] Tests are meaningful (not just for coverage)
```

### Test Quality

```yaml
checklist:
  - [ ] Tests have clear names describing behavior
  - [ ] Each test verifies one thing
  - [ ] Tests are independent (no shared state)
  - [ ] No flaky tests
  - [ ] Mocks are appropriate (not over-mocking)

good_test_name:
  pattern: "should [expected behavior] when [condition]"
```

## Severity Indicators

```yaml
blockers:
  prefix: "BLOCKER:"
  triggers: [security vulnerability, data loss risk, breaking change without migration]

major:
  prefix: "MAJOR:"
  triggers: [significant bug, performance issue, missing error handling, type safety issue]

minor:
  prefix: "MINOR:"
  triggers: [code style inconsistency, missing optimization, missing edge case test]

nitpick:
  prefix: "NIT:"
  triggers: [naming preference, formatting, import ordering]
```
