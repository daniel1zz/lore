# Test Maintainability — Anti-Patterns, Quality, and Sustainability

**Purpose**: Prevent test suite degradation. Tests are code — they need quality attention.

## Structural Anti-Patterns

| Anti-Pattern | Signal (how AI detects) | Fix |
|-------------|------------------------|-----|
| **Mystery Guest** | Test references data without setup; file paths or DB queries with no corresponding creation in test | Inline test data or use explicit factory in test body |
| **Eager Test** | Single `it` with multiple unrelated actions (multiple When phases) | Split: one action, one behavior per test |
| **Conditional Logic** | `if`/`else`/`switch` inside test body | Remove branching; use parameterized `it.each` for variants |
| **Test Interdependence** | Shared mutable variable modified across `it` blocks; tests fail when shuffled | Reset state in `beforeEach`; each test self-contained |
| **Shared Mutable State** | `let` at `describe` scope, mutated inside `it` | `beforeEach` reinitialize; prefer `const` with fresh instances |

## Assertion Anti-Patterns

| Anti-Pattern | Signal | Fix |
|-------------|--------|-----|
| **Assertion Roulette** | >3 unrelated `expect()` with no grouping or messages | Group related assertions or split tests; add messages |
| **Silent Catcher** | `try/catch` where catch doesn't re-throw or assert | Use `expect(...).rejects.toThrow()` instead |
| **The Inspector** | Tests access private fields, internal methods, internal data structures | Test through public API; assert on observable behavior |
| **Giant Assertion** | `toEqual` on entire large object when only 1-2 fields matter | Use `toMatchObject`, `toHaveProperty`, or extract specific fields |

## Maintenance Anti-Patterns

| Anti-Pattern | Signal | Fix |
|-------------|--------|-----|
| **Slow Poke** | `setTimeout`, real network calls, unmocked DB in unit tests | Mock externals; reserve real I/O for integration |
| **Flickering Test** | Uses `Date.now()`, `Math.random()`, race conditions, port binding | Inject time/randomness; deterministic fixtures |
| **Dead Tree** | Tautological assertion or obsolete code path; test never fails | Delete or rewrite with meaningful assertion |
| **Excessive DRY** | Reader must jump 3+ helper levels to understand what's tested | Apply DAMP (see below) |

## DRY vs DAMP

**DAMP = Descriptive And Meaningful Phrases.** Tests favor readability over abstraction.

| Guideline | Rule |
|-----------|------|
| Extract ONLY when | ≥3 tests share identical setup AND the helper has a clear domain name (`createAuthenticatedUser`, not `setupTest`) |
| Duplicate when | Setup provides context for understanding the test; 2 tests sharing setup is not enough to extract |
| Parameterize when | Same behavior with different inputs → `it.each` / `test.each` |
| Never extract | Assertions — they ARE the test's purpose. Always visible in the test body |

## Test Code Quality

### Naming
```
describe('[Module/Function]', () => {
  it('should [expected behavior] when [condition]', () => { ... })
  // OR
  it('[action] [result] given [precondition]', () => { ... })
})
```

### Structure (AAA)
```typescript
it('should reject expired tokens', () => {
  // Arrange — set up preconditions
  const token = createToken({ expiresAt: pastDate });

  // Act — perform the action
  const result = validateToken(token);

  // Assert — verify outcome
  expect(result.valid).toBe(false);
  expect(result.reason).toBe('expired');
});
```
One Arrange, one Act, related Asserts. If you need a second Act → second test.

### Isolation
- Each test creates its own data (no reliance on test execution order)
- `beforeEach` for shared setup, never `beforeAll` for mutable state
- Clean up side effects in `afterEach`
- No global state mutations without restoration

## Execution Optimization

| Strategy | When | How |
|----------|------|-----|
| **Parallel execution** | Large unit test suite | `vitest --pool=threads` / `jest --maxWorkers=50%` |
| **Test sharding** | CI with multiple nodes | `vitest --shard=k/n` / timing-based split |
| **Selective execution** | PR feedback loop | `vitest --changed` / Turborepo `--affected` |
| **Watch mode** | Local development | `vitest --watch` (re-runs on file change) |
| **Slow test detection** | Suite > 30s | Profile with `--reporter=verbose`, move slow tests to integration |

## Test Debt Signals

| Signal | Action |
|--------|--------|
| Test suite > 5 min (unit) | Profile and split; mock slow dependencies |
| Flaky rate > 2% | Quarantine → root cause → fix. See flaky handling in mode-e2e |
| Coverage declining on new code | Enforce diff coverage gate (≥80% on changed lines) |
| Tests that test mocks, not behavior | Rewrite to test observable outcomes |
| Large test file (>500 lines) | Split by concern; extract fixtures to separate files |
