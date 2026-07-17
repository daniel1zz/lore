# Mode: Property-Based Testing (PBT)

**Purpose**: Generate test inputs automatically from properties and arbitraries, finding edge cases humans miss.

## Loop Specialization

| Step | PBT specifics |
|------|---------------|
| ANALYZE | Identify functions with expressible properties: inverse pairs, idempotent ops, Zod schemas, state machines |
| DESIGN | Select property patterns (see heuristics below), build arbitraries, define shrinking needs |
| SETUP | `npm install fast-check @fast-check/vitest` (or `@fast-check/jest`). Import `zod-fast-check` if Zod schemas exist |
| EXECUTE | Run with `test.prop` (vitest/jest) or `fc.assert(fc.property(...))` |
| GATE | All properties hold for 100+ samples. No shrunk counterexample. Combine with example-based tests |
| PERSIST | Update test-plan with: properties tested, sample count, counterexamples found |

## Property Identification Heuristics

| Pattern | Detection Signal | Property Template |
|---------|-----------------|-------------------|
| **Round-trip** | Function pair `encode`/`decode`, `serialize`/`parse` with matching types | `decode(encode(x)) === x` |
| **Idempotency** | Functions named `normalize`, `format`, `sort`, `deduplicate`; return type = input type | `f(f(x)) === f(x)` |
| **Invariant** | Collection operations: sort, filter, map, reduce | `sorted.length === original.length` |
| **Commutativity** | Set operations, merge functions, arithmetic | `merge(a, b) deepEquals merge(b, a)` |
| **Monotonicity** | Scoring, pricing, comparator functions | `x <= y → f(x) <= f(y)` |
| **Oracle** | Two implementations of same interface (optimized vs naive) | `fastImpl(x) === referenceImpl(x)` |
| **Domain rules** | JSDoc `@invariant`, Zod constraints, business rules in spec | `order.total >= 0` |

## Arbitrary / Generator Patterns

**From Zod schemas** (highest leverage for AI):
```typescript
import { ZodFastCheck } from 'zod-fast-check';
const userArb = ZodFastCheck().inputOf(UserSchema); // auto-derives from Zod
```

**Constrained types**:
- `fc.integer({ min: 1, max: 100 })` — bounded int
- `fc.emailAddress()` — valid emails
- `fc.date({ min, max })` — date range
- `fc.stringMatching(/^[A-Z]{2}\d{4}$/)` — regex-constrained

**Recursive structures** — `fc.letrec`:
```typescript
const { tree } = fc.letrec(tie => ({
  tree: fc.oneof({ depthSize: 'small' }, tie('leaf'), tie('node')),
  node: fc.tuple(tie('tree'), tie('tree')),
  leaf: fc.nat(),
}));
```

**State sequences** — `fc.commands` for model-based testing:
```typescript
fc.assert(fc.property(fc.commands(allCommands), commands => {
  const model = new Model();
  const real = new RealSystem();
  fc.modelRun(() => ({ model, real }), commands);
}));
```

## Integration

**vitest** (preferred):
```typescript
import { test, fc } from '@fast-check/vitest';

test.prop([fc.string(), fc.string()])('concat includes both', (a, b) => {
  expect(a + b).toContain(a);
  expect(a + b).toContain(b);
});
```

**jest**: Same API via `@fast-check/jest`.

**Manual** (any runner): `fc.assert(fc.property(...arbs, predicate))` inside any `test()`.

## Shrinking

- Automatic and built-in — every arbitrary has its own shrink tree.
- Provide `unmapper` to `.map()` for better shrinking.
- Use `fc.noShrink` / `fc.limitShrink(n)` when needed.
- Custom shrinkers only for: external generators (Faker), complex domain objects with cross-field constraints.

## When PBT Is Essential vs Overkill

| Essential | Overkill |
|-----------|----------|
| Serialization / parsing | Simple CRUD |
| State machines | UI snapshots |
| Algorithmic code | One-off scripts |
| Data transformation pipelines | Config loading |
| Any code with mathematical invariants | Thin wrappers |

## AI-Native Advantages

| Capability | How AI Exploits It |
|------------|-------------------|
| Zod → Arbitrary | Read existing Zod schemas → auto-generate `ZodFastCheck().inputOf(schema)` |
| Type signature → Properties | `(a: T) => T` same-type → idempotency candidate; paired functions → round-trip |
| JSDoc → Invariants | Parse `@throws`, `@returns`, `@invariant` → property predicates |
| Code diff → Regression | On refactor: `oldImpl(x) === newImpl(x)` behavioral equivalence property |
| State diagrams → Model | Parse XState/Redux → auto-generate `fc.commands` |

## Packages

`fast-check` (core), `@fast-check/vitest`, `@fast-check/jest`, `zod-fast-check` (Zod bridge).

## Official Docs (MANDATORY)
- context7: resolve-library-id for fast-check → query-docs for arbitraries, properties, model-based
