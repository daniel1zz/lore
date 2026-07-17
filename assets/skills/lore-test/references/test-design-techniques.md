# Test Design Techniques — Systematic Test Case Derivation

**Purpose**: Cross-cutting techniques for deriving complete test cases from code structure. Apply BEFORE writing any test — these determine WHAT to test.

## Technique Selection Matrix

| Technique | Trigger Signal | Primary Value | Typical Test Count |
|-----------|---------------|---------------|-------------------|
| **EP** | Any parameter with domain splits | Base coverage per partition | 3-5 per param |
| **BVA** | Numeric/length comparisons, Zod `.min()/.max()` | Off-by-one bugs | 3 per boundary |
| **Decision Table** | 2+ boolean conditions with cross-product effects | Logic completeness | 2^n (collapsible) |
| **State Transition** | Status enums, lifecycle methods, FSM patterns | Invalid transition bugs | states × events |
| **Pairwise** | ≥3 discrete params, large cross-product | Interaction coverage, minimal cases | ~n·log(n) |
| **CTM** | Hierarchical/nested input with orthogonal dimensions | Structured decomposition | risk-weighted subset |

**Agent workflow**: EP first (always) → BVA if boundaries → Decision Table or State Transition if patterns match → Pairwise/CTM only for large parameter spaces. Layer fast-check properties on top.

---

## 1. Equivalence Partitioning (EP)

**Signal**: Parameter with implicit/explicit domain splits — numeric ranges, string formats, union types, enum subsets, nullable values.

**Steps**:
1. Read function signature and body. Identify each parameter.
2. Extract partitions from: type narrowing (`if typeof x === 'string'`), validation guards (`if (x < 0) throw`), switch/if-else branches, Zod schemas (`.min()`, `.max()`, `.regex()`).
3. Pick one representative value per partition. Add one value for the "invalid" partition.

**Example**: `applyDiscount(amount: number, tier: 'bronze' | 'silver' | 'gold')`
- `amount` partitions: negative, zero, positive → 3 classes
- `tier` partitions: each enum member + invalid string → 4 classes
- Base cases: 3 × 4 = 12

**fast-check**: `fc.oneof(fc.constant(-1), fc.nat(), fc.constant(0))` — draw from explicit partitions.

---

## 2. Boundary Value Analysis (BVA)

**Signal**: Numeric comparisons (`>=`, `<`), `.length` checks, array index access, date ranges, pagination, Zod `.min(n)/.max(n)`.

**Steps**:
1. Scan for every comparison operator → extract boundary constant `n`.
2. Test: `n-1`, `n`, `n+1`. For float: also `n ± epsilon`.
3. For string/array lengths: empty, length at boundary, boundary ± 1.
4. Prioritize off-by-one prone patterns: `<` vs `<=`, `slice(0, n)`, zero-indexed loops.

**Example**: `paginate(items: T[], page: number, size: number)` with guard `if (page < 1) throw`
- Test page = 0, 1, 2; size = 0, 1; items.length = 0, 1, exactly `size`, `size+1`

**fast-check**: `fc.integer({min: boundary-1, max: boundary+1})` — constrain to interesting zone.

---

## 3. Decision Table Testing

**Signal**: 2+ independent boolean conditions whose combinations produce different outcomes. Typical: authorization checks, feature flag combos, multi-condition validation.

**When worth it**: ≥2 conditions with cross-product effects. NOT worth it for sequential guards that short-circuit independently.

**Steps**:
1. Identify all boolean conditions (including implicit nullability).
2. Build truth table: columns = conditions, rows = all 2^n combinations.
3. Collapse "don't care" rows where outcome is identical.
4. Generate one test per non-collapsed row.

**Example**:
```typescript
function canAccess(user: User, resource: Resource): boolean {
  const isOwner = user.id === resource.ownerId;
  const isAdmin = user.role === 'admin';
  const isPublic = resource.visibility === 'public';
  return isOwner || isAdmin || isPublic;
}
```
Decision table: 2^3 = 8 rows. Only `(F,F,F)` → `false`. Test all 8.

**fast-check**: `fc.record({isOwner: fc.boolean(), isAdmin: fc.boolean(), isPublic: fc.boolean()})` covers full space.

---

## 4. State Transition Testing

**Signal**: Enum/string-literal `status`/`state` field, methods like `transition()`, `advance()`, Redux reducers, XState machines, objects with lifecycle (draft → published → archived).

**Steps**:
1. Extract states: enum types, union literals (`type Status = 'idle' | 'loading' | 'error'`), state objects.
2. Extract transitions: every code path that changes state → record `(fromState, event, toState)`.
3. Build transition table. Identify valid AND **invalid** transitions.
4. Test: (a) every valid transition, (b) every invalid transition (should throw/no-op), (c) round-trip paths.

**Example**:
```typescript
type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
```
Test matrix: 5 states × all events. Invalid: `transition('delivered', 'ship')` should throw.

**fast-check**: Model-based testing — `fc.commands()` with model tracking expected state, verifying each transition.

---

## 5. Pairwise / Combinatorial Testing

**Signal**: ≥3 independent parameters, each with multiple discrete values. Full cross-product too large but most bugs from 2-way interactions.

**Steps**:
1. List all parameters and value sets (from EP).
2. Generate covering array: `pict` CLI, `allpairs`, or `fast-check` with bias.
3. Each row = one test case covering a unique pair combination.

**Example**: `search(query, sort: 'date'|'relevance', page, lang: 'en'|'fr'|'de')`
- Full combo with EP values: ~100+ cases. Pairwise: ~12-15 cases.

**When to use**: Parameter count ≥ 3, discrete values. NIST data: 2-way covers 70-90% of defects.

---

## 6. Classification Tree Method (CTM)

**Signal**: Complex input with hierarchical structure — nested objects, multi-level config, request with sub-options.

**Steps**:
1. Decompose input into **classifications** (dimensions): `paymentMethod`, `currency`, `amountRange`, `userRegion`.
2. Enumerate **classes** per classification: `card | bank | wallet`, `micro | normal | large`.
3. Select test cases: (a) one from each class (base), (b) pairwise across classifications, (c) risk-weighted for high-risk paths.

**Example**:
```typescript
interface PaymentRequest {
  method: 'card' | 'bank_transfer' | 'wallet';
  amount: number;       // micro | normal | large
  currency: Currency;   // domestic | foreign
  user: { verified: boolean; region: 'US' | 'EU' | 'APAC' };
}
```
4 dimensions with 3, 3, 2, 6 classes = 108 full combos. CTM selects ~15-20 risk-weighted cases.
