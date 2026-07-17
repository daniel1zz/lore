# Vitest Testing Conventions

## Configuration
- `vitest.config.ts` at project root (or inline in `vite.config.ts`)
- Coverage via `@vitest/coverage-v8`
- Path aliases matching tsconfig paths

## Test Structure
```typescript
describe('OrderService', () => {
  describe('createOrder', () => {
    it('creates order with valid items', async () => { /* happy path */ });
    it('throws when cart is empty', async () => { /* negative */ });
    it('handles max quantity boundary', async () => { /* boundary */ });
    it('rolls back on payment failure', async () => { /* error */ });
  });
});
```

## Coverage Dimensions
- **HAPPY**: Golden path with valid inputs
- **NEGATIVE**: Invalid inputs, missing required fields, unauthorized access
- **BOUNDARY**: Empty arrays, max values, zero, null/undefined
- **ERROR**: Network failures, timeouts, concurrent modifications
- **STATE**: State transitions, race conditions, idempotency
- **REGRESSION**: Specific bugs that were fixed (reference issue/PR)

## Mocking
- `vi.mock()` for module-level mocks
- `vi.spyOn()` for partial mocking
- `vi.fn()` for inline mock functions
- Reset between tests: `beforeEach(() => vi.restoreAllMocks())`
- Prefer dependency injection over module mocking when possible

## Patterns
- Co-locate test files: `foo.ts` → `foo.test.ts` (same directory)
- Factory functions for test data (not raw object literals)
- `describe.each` / `it.each` for parametric tests
- `expect.soft()` for non-blocking assertions in multi-check tests

## CLAUDE.md Section Template

```markdown
## Testing (Vitest)
- Co-located tests: foo.ts → foo.test.ts in same directory
- Six dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
- Factory functions for test data, vi.restoreAllMocks() in beforeEach
- Prefer DI over module mocking, describe.each for parametric tests
- Coverage target: statements 80%+, branches 75%+
```
