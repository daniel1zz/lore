# Six-Dimension Test Coverage — Test Quality Discipline

> Layer 2 project conventions for testing. MUST/SHOULD/MUST NOT only.

## Test File Coverage

- MUST create a corresponding test file for every business logic file
- Test file naming MUST match the source file with a test suffix/prefix per language convention:
  - TypeScript/JavaScript: `foo.test.ts` / `foo.spec.ts`
  - Python: `test_foo.py`
  - Go: `foo_test.go`
  - Rust: inline `#[cfg(test)]` module or `tests/foo.rs`
  - Java/Kotlin: `FooTest.java` / `FooTest.kt`
  - Swift: `FooTests.swift`
  - C#: `FooTests.cs`
  - C++: `foo_test.cpp`
  - PHP: `FooTest.php`
  - Perl: `foo.t`
- MUST co-locate test files with source (same directory or parallel `tests/` / `__tests__/` directory) per project convention
- MUST NOT mark implementation tasks as complete without corresponding test files

## What Counts as Business Logic

- Domain services, use cases, application logic, data transformations, validators, state machines
- Excludes: type definitions, constants, re-exports, config files, DI wiring, pure DTOs

## ⛔ Test Design Before Test Code (mandatory pre-step)

Root cause of shallow tests: AI jumps straight to writing test code, producing structural-looking but meaningless tests. **Test design MUST precede test implementation.**

### Mandatory workflow

1. **ANALYZE** the code under test:
   - Read the source file, identify public functions/methods
   - List input parameters, return types, side effects, dependencies
   - Identify branch conditions (`if/else`, `switch`, error throws, guard clauses)
   - Identify state transitions (if stateful)

2. **DERIVE** test cases using techniques (apply in order):
   - **EP** (always): Partition each input into valid/invalid classes → 1 test per partition
   - **BVA** (when boundaries exist): For each numeric/string/collection param → test at boundary, boundary-1, boundary+1
   - **Decision Table** (when 2+ conditions): Cross-product of boolean conditions → test each combination
   - **State Transition** (when stateful): Draw state machine → test valid + invalid transitions

3. **PLAN** test cases before writing code:
   ```
   // Test plan for UserService.createUser:
   // EP: valid user (happy), empty email (negative), duplicate email (negative)
   // BVA: name length 0, 1, 255, 256
   // Error: DB connection failure, unique constraint violation
   // State: N/A (stateless)
   // Regression: #42 duplicate email silent overwrite
   // Total: 9 test cases across 5 dimensions
   ```

4. **IMPLEMENT** tests from the plan (not from looking at implementation)

### Gate
`verify-before-complete.mjs` checks for `test_design.techniques` in verification_evidence. Missing → warning.

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "The implementation is simple, tests are obvious" | Simple code has boundary bugs. Design catches what intuition misses. |
> | "I'll add more tests later" | You won't. Coverage only goes down after initial commit. |
> | "Happy path is enough for now" | Happy path tests catch 0% of production bugs. |
> | "Writing test design takes too long" | 30 seconds of planning saves 10 minutes of debugging wrong tests. |

## Test Quality

- MUST test behavior (inputs/outputs), not implementation details
- MUST NOT write tests that merely assert the implementation was called (tautological tests)

## ⛔ Six-Dimension Test Coverage (mandatory per public function/method)

Every test file MUST cover **all applicable** dimensions. Inapplicable dimensions MUST be annotated `// N/A: <reason>`.

| Dim | Name | What to test | Example |
|---|---|---|---|
| **HAPPY** | Happy path | Valid inputs → expected outputs, golden path flows | `createUser({name, email}) → User` |
| **NEGATIVE** | Negative / rejection | Invalid inputs, precondition violations → correct error/rejection | `createUser({email: ""}) → ValidationError` |
| **BOUNDARY** | Boundary values | Empty, zero, max, off-by-one, just-at-limit, just-over-limit | `paginate({page: 0}), paginate({page: MAX_INT})` |
| **ERROR** | Error / failure | External dependency failures: network, DB, file I/O, third-party API | `createUser() when DB connection lost → DBError` |
| **STATE** | State transitions | Illegal state transitions, idempotency, concurrent modification | `order.cancel() when already shipped → InvalidStateError` |
| **REGRESSION** | Regression guard | From bug reports, historical issues, or known edge cases discovered during implementation | `// Regression: #42 — duplicate email silently overwrites` |

### Structural convention

Test files MUST use `describe` blocks (or language equivalent) to group by dimension:

```typescript
describe("UserService.createUser", () => {
  describe("happy path", () => { ... });
  describe("negative cases", () => { ... });
  describe("boundary values", () => { ... });
  describe("error handling", () => { ... });
  describe("state transitions", () => { ... }); // or: // N/A: stateless function
  describe("regression", () => { ... });        // or: // N/A: no known regressions
});
```

### Minimum coverage rules

- **HAPPY**: ≥1 test per public function — MUST
- **NEGATIVE**: ≥1 test per public function that accepts input — MUST
- **BOUNDARY**: ≥1 test per public function with numeric/string/collection params — MUST
- **ERROR**: ≥1 test per public function that calls external dependencies — MUST
- **STATE**: ≥1 test per stateful object/workflow — MUST (N/A for stateless pure functions)
- **REGRESSION**: as discovered — SHOULD (N/A annotation acceptable when no known regressions)

### Anti-patterns (MUST NOT)

- Writing only happy path tests and claiming "coverage is sufficient"
- Testing only the implementation's current behavior without challenging assumptions
- Using `any` / `as unknown as X` to bypass type safety in test fixtures
- Copy-pasting implementation logic into test assertions (tautological)
- Mocking the unit under test itself

> | 🚩 AI rationalization | Reality |
> |---|---|
> | "N/A for this function" | N/A requires explicit annotation with reason. Unannotated = skipped. |
> | "Boundary testing is overkill here" | Off-by-one is the #1 bug class. Boundaries are never overkill. |
> | "No known regressions exist" | Annotate `// N/A: no known regressions` — silence ≠ absence. |

## ⛔ Test Authoring Separation (Self-Verification Paradox mitigation)

Root cause: Same agent writing implementation + tests has **Self-Verification Paradox** — tests tend to confirm the implementation's assumptions rather than challenge them.

### Rules

- **complexity ≥ medium (lore plan tasks)**: Tests MUST be written by a **separate subagent** from the implementation author. The test subagent receives the spec/AC + function signatures, NOT the implementation source. This forces black-box test design.
- **trivial tasks (≤2 files, no design decisions)**: Same agent MAY write both implementation and tests (subagent overhead not justified).
- **TDD exception**: When following strict TDD (RED → GREEN → REFACTOR), the same agent writes tests first (RED) before implementation exists. This is acceptable because tests are written against the spec, not the implementation.

### Dispatch pattern for test subagent

```
Agent(subagent_type="lore-implementer", prompt=`
  Task: Write tests for <module>
  Spec/AC: <from plan task>
  Function signatures: <extracted from implementation>
  DO NOT read implementation source — test against spec behavior only.
  Required dimensions: HAPPY, NEGATIVE, BOUNDARY, ERROR, STATE, REGRESSION
`)
```
