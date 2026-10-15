---
name: lore-test
description: "Use when the user says 'write tests', 'add test coverage', 'regression test', 'check test quality', 'test this component', 'test this API', 'e2e test', 'integration test', 'unit test', 'load test', 'test strategy', or asks about flaky tests, mocking or test architecture. NOT for test-first development (use lore-tdd), exploratory QA (use lore-dogfood), or requirement-driven acceptance (use lore-uat). Args: '<mode> [context]' — the FIRST token is the mode, one of: accessibility|android|e2e|eval|exploratory|frontend|performance|property-based|security|strategy."
---

# Test - Mode: $0

| Mode | Reference | Focus |
|------|-----------|-------|
| `audit` | _(inline)_ | 6-dimension compliance audit across project — external oracle grep |
| `author-separated` | _(inline)_ | Force test authoring separation — route to independent subagent |
| `unit` | _(inline)_ | Functions/methods, mocking, mutation |
| `integration` | _(inline)_ | Module interactions, API endpoints, DB ops, service boundaries |
| `contract` | _(inline)_ | API/MCP/event schema validation, provider-consumer |
| `e2e` | `references/mode-e2e.md` | User journeys, Playwright, agent-browser, visual regression |
| `frontend` | `references/mode-frontend.md` | Component testing, React/Vue/Svelte, hooks, Testing Library |
| `android` | `references/mode-android.md` | Android app testing, maestro flows + mobile-mcp |
| `strategy` | `references/mode-strategy.md` | Multi-perspective risk-based test strategy |
| `performance` | `references/mode-performance.md` | Load (k6/Artillery), CWV (Lighthouse), benchmarks, chaos |
| `security` | `references/mode-security.md` | OWASP, SAST (Semgrep), DAST (ZAP), SCA, threat modeling |
| `accessibility` | `references/mode-accessibility.md` | WCAG AA, automated + manual |
| `property-based` | `references/mode-property-based.md` | fast-check properties, Zod→Arbitrary, model-based |
| `exploratory` | `references/mode-exploratory.md` | Charter-based SBTM, SFDPOT heuristics, tours |
| `eval` | `references/mode-eval.md` | Business/semantic quality evaluation (AI, search, content) |

No mode → ask user. For modes with reference files, read them first.

---

## ⛔ Core Principle: Tests Exist to Find Bugs

A test suite that passes on buggy code provides **false confidence** — worse than no tests at all.

**Spec-first, not code-first**: Derive expected behaviors from spec/AC BEFORE reading implementation. Reading implementation first causes tautological tests that mirror (and thus validate) bugs.

**Adversarial mindset**: The tester's job is to BREAK the code, not to confirm it works. Every suspicious pattern in source code (fallbacks, hardcoded values, silent catches) is a potential bug to be challenged.

**Failing tests are successes**: A test that fails because the implementation contradicts the spec has found a defect. Report it — don't adjust the expected value to match the code.

---

## Unified Loop (all modes)

Every mode follows this 10-step closed loop. Per-mode sections specify what each step produces.

```
1. CONTEXT    → Load project context, detect test stack, query official docs
1b. SPEC-FIRST → ⛔ Read spec/AC, write expected behaviors BEFORE reading code
2. ANALYZE    → Identify target code/surface (Serena: find_symbol; fallback: Grep)
2b. DEFECT-HUNT → ⛔ Scan implementation for suspicious patterns (fallbacks, hardcoded, silent catches)
3. TECHNIQUES → Select test design techniques (EP/BVA/Decision Table/State Transition/Pairwise)
4. DESIGN     → Apply techniques to derive test cases, estimate count
5. SETUP      → Prepare environment, test data, isolation boundaries
6. EXECUTE    → Run tests
7. GATE       → Evaluate quality gates (pass/fail + exit criteria)
8. CLEANUP    → Teardown environment, collect failure artifacts
9. PERSIST    → Write results to the lore corpus (test-plan knowledge doc update or new entry)
```

> **Note**: Steps 2 (ANALYZE), 6 (EXECUTE), 8 (CLEANUP) are mode-specific — see per-mode tables in inline modes and reference files. Only cross-cutting steps have shared subsections below.

### Step 1: CONTEXT (shared)
- lore corpus: PRD acceptance criteria (`lore get <prd>`), existing test-plan knowledge docs (`lore search "<q>" --type knowledge --json`), feature-spec AC (`lore ac list <spec>`)
- Detect stack from `package.json` / config files → load project conventions
- Query official docs (context7; fallback: deepwiki, gitmcp) for framework patterns
- If feature-spec exists → extract AC as test case seeds

### Step 1b: SPEC-FIRST — Derive Expectations Before Reading Code (⛔ MANDATORY)

**Why**: Reading implementation before writing expectations causes Self-Verification Paradox — the tester unconsciously tests "what the code does" instead of "what the code should do". This is the #1 root cause of tests that pass on buggy code.

**Procedure**:
1. Read the spec/AC (from Step 1 output)
2. For each AC item, write down in plain text:
   - **Given** [precondition from spec]
   - **When** [action from spec]
   - **Then** [expected outcome from spec — NOT from code]
3. For each AC item, also write expected REJECTION behaviors:
   - What inputs should be rejected? How? (throw? return error? 400 status?)
   - What states are invalid for this operation?
4. Record these as test skeleton comments BEFORE proceeding to Step 2

**Example**:
```
// From AC: "calculateDiscount MUST apply tier-based discounts"
// Expected BEFORE reading code:
//   Given gold tier → 15% discount
//   Given unknown tier → MUST throw InvalidTierError (not return 0%)
//   Given negative amount → MUST throw (not return negative)
```

⛔ If no spec/AC exists: read ONLY the public function signature + JSDoc/comments. Infer expected behavior from the function name and parameter types. Do NOT read the function body yet.

### Step 2b: DEFECT-HUNT — Adversarial Source Scan (⛔ MANDATORY)

**Why**: After writing spec-based expectations, NOW read the implementation to find patterns that contradict or go beyond the spec.

**Scan for these suspicious patterns** (grep the source file):

| Pattern | Grep Signal | Test Action |
|---------|-------------|-------------|
| **Silent fallback** | `?? `, `\|\| `, `?? "`, `?? 0`, `?? []`, `?? {}` | Test: does the spec say this should fallback, or should it throw? Write a test asserting the spec-correct behavior. |
| **Silent catch** | `catch {`, `catch (e) { return`, `catch (e) { }` | Test: what happens when the dependency fails? Is the error propagated or swallowed? |
| **Hardcoded value** | Magic numbers, string literals not from constants | Test with different inputs — if output doesn't change, the value is hardcoded |
| **Missing validation** | No null/undefined checks on parameters | Test with null/undefined — verify it either validates or the spec says it's safe to skip |
| **Type assertion** | `as any`, `as unknown as`, `!` (non-null assertion) | Test the case where the value IS null/undefined — the assertion may be hiding a runtime error |
| **Conditional return** | `if (x) return early` without else | Test the else path — is it intentional or a missing case? |

**For each finding**: Write a test that verifies the SPEC-INTENDED behavior, not the code's current behavior. If the test fails, you've found a defect.

### Step 3: TECHNIQUES — Test Design Engine

**⛔ MANDATORY before writing any test.** Read `references/test-design-techniques.md` for full details.

Select applicable techniques based on code signals:

| Technique | Trigger Signal | Apply When |
|-----------|---------------|------------|
| **EP** (Equivalence Partitioning) | Any parameter with domain splits | Always — baseline technique |
| **BVA** (Boundary Value Analysis) | Numeric comparisons, `.length`, Zod `.min/.max` | Boundaries exist in code |
| **Decision Table** | 2+ boolean conditions with cross-product effects | Authorization, feature flags, multi-condition validation |
| **State Transition** | Status enums, lifecycle methods, FSM patterns | Stateful objects or workflows |
| **Pairwise** | ≥3 discrete params, large cross-product | Parameter space too large for exhaustive |
| **CTM** (Classification Tree Method) | Hierarchical/nested input with orthogonal dimensions | Complex request objects |

**Agent workflow**: EP first (always) → BVA if boundaries → check for Decision Table or State Transition patterns → Pairwise/CTM for large spaces → layer fast-check properties on top.

Also apply AI-native techniques (see `references/ai-native-testing.md`):
- **Pattern-based generation**: null guards → null/undefined/empty tests; mutual exclusion → combination tests; retry logic → boundary-retry tests
- **Cross-reference consistency**: verify enum exhaustiveness, schema-type alignment, config-env sync

### Step 4: DESIGN — Coverage Dimensions

Check applicable dimensions per mode:

```
□ Happy path (from AC)          □ Edge/boundary values (from BVA)
□ Error/exception paths         □ Concurrency/race conditions
□ Idempotency                   □ State transitions (from ST technique)
□ Permission/authorization      □ Time/timezone sensitivity
□ Resource cleanup/leak         □ Regression (change impact)
□ Snapshot/golden output        □ Retry/timeout behavior
□ Domain logic (entity invariants, VO validation, aggregate rules)
□ Properties (round-trip, idempotency, invariant — from PBT)
□ Metamorphic relations (for non-deterministic output)
```

> **Domain logic dimension**: When project has domain ADRs or knowledge retros in the lore corpus, ensure entity methods, value object validation, and aggregate invariants have dedicated unit tests.

### Step 4b: BDD/ATDD Pattern (when feature-spec AC exists)

Derive tests from AC using Given-When-Then:

```typescript
describe('[Feature from AC]', () => {
  it('should [expected behavior] when [condition]', () => {
    // Given — arrange preconditions
    const user = await createUser({ email: 'test@example.com' });
    // When — single action under test
    const result = await resetPassword(user.email);
    // Then — verify outcome
    expect(result.status).toBe('sent');
  });
});
```

**Specification by Example**: When spec has concrete examples/tables → use `it.each`:
```typescript
it.each([
  { tier: 'gold',   discount: 0.15 },
  { tier: 'silver', discount: 0.10 },
  { tier: 'bronze', discount: 0.05 },
])('applies $discount for $tier', ({ tier, discount }) => {
  expect(calculateDiscount(tier)).toBe(discount);
});
```

**ATDD workflow**: Read AC → generate ALL test skeletons (Red) → implement until pass (Green) → refactor.

### Step 5: SETUP — Data Strategy

- **Deterministic**: seeded faker, fixed UUIDs, fake clock (`vi.useFakeTimers`)
- **Factories**: fishery or custom builders for domain objects
- **Golden fixtures**: checked-in reference data for snapshot/regression
- **Isolation**: temp dirs, test DB, network blocking (msw/nock), env var sandboxing
- **From EP/BVA**: one representative per partition, boundary values at limits
- **From PBT**: Zod→Arbitrary generation via `zod-fast-check`, constrained generators
- **Per-mode extras**: see inline/reference sections

### Step 7: GATE — Quality Gates (Tiered)

**Critical paths** (payments, auth, core domain):

| Gate | Threshold |
|------|-----------|
| All tests pass | 100% |
| No flaky (rerun 3×) | 0 flaky |
| Line coverage | 90% |
| Branch coverage | 85% |
| Mutation score | 80% |

**Standard paths**:

| Gate | Threshold |
|------|-----------|
| All tests pass | 100% |
| No flaky (rerun 3×) | 0 flaky |
| Line coverage | project config or 80% |
| Branch coverage | project config or 70% |
| Mutation score (opt-in) | 60% |

**Cross-cutting gates** (all modes):

| Gate | Threshold |
|------|-----------|
| AC coverage (requirements traceability) | 100% of ACs have ≥1 test |
| Diff coverage (new code only) | ≥80% on changed lines |
| Schema match | 100% (contract mode) |
| SLO compliance | per-project SLOs (performance) |
| OWASP scan clean | 0 critical/high (security) |
| WCAG AA pass | 0 violations (accessibility) |
| All flows pass | 100% (android, e2e) |

**Exit Criteria** (when are we done testing?):
1. All planned test cases executed
2. All quality gates pass
3. No open Critical/High defects
4. Risk items from strategy mode all addressed
5. AC coverage = 100%

If gate fails → fix or document as known issue with justification. Never silently skip.

### Step 9: PERSIST — lore Integration

- **strategy mode**: `lore create knowledge --sub-type reference --title "Test Plan: <feature>" --content ...` + link to PRD/feature-spec via `lore link <test-plan-slug> <spec-slug> --type=relates-to`
- **Other modes after execution**: update existing test-plan knowledge doc with results section (`lore set <test-plan-slug> --content ...`):
  ```
  ## Test Results — {mode} ({date})
  - Pass/Fail: X/Y
  - Coverage: N% (line) / N% (branch) / N% (mutation)
  - AC coverage: N/M ACs verified
  - Artifacts: [list]
  - Known issues: [list or NONE]
  ```
- **From feature-spec AC → test skeleton**: generate `describe/it` blocks from AC items using GWT pattern

---

## Cross-Cutting References

| Topic | File | Read When |
|-------|------|-----------|
| Test Design Techniques | `references/test-design-techniques.md` | **Always** — before Step 3 |
| **⛔ Six-Dimension Coverage** | `references/six-dim-coverage.md` | **Always** — every test file MUST cover HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION (or annotate `// N/A: <reason>`) |
| **⛔ False-Green Anti-Patterns** | `references/false-green-patterns.md` | **Before commit / review** — 8 known patterns (vi.mock amnesia, `as unknown as` bypass, snapshot-only, no-assert, tautology, mocking unit under test, stub empty payloads, fetch body unverified) |
| **⛔ Failure-First Discipline** | `../shared/verification-discipline.md` | **Always** — (1) every NEW test must be SEEN RED before its green counts (break the input or revert the fix — an oracle never observed failing proves nothing); (2) NEGATIVE/ERROR dimensions enumerate the contract's MANDATED failures (exit codes, thrown types, messages) before reading the implementation; (3) exit codes measured UNPIPED (`cmd > out 2>&1; echo $?`, never `cmd \| head; echo $?`); (4) every fix-verifying test ships its negative-control sibling (the adjacent behavior that must STILL fail/reject) |
| Test Maintainability | `references/test-maintainability.md` | Writing or reviewing tests |
| CI/CD Pipeline | `references/ci-cd-pipeline.md` | Setting up test infrastructure |
| AI-Native Testing | `references/ai-native-testing.md` | Leveraging AI agent capabilities |
| Frontend / Component | `references/mode-frontend.md` | React/Vue/Svelte component testing, hooks, Testing Library |
| Eval Mode | `references/mode-eval.md` | Business/semantic quality evaluation |

---

## Inline Modes

### audit

**Purpose**: External oracle grep-based compliance audit. No self-assessment — all findings from filesystem scans.

| Loop step | Specifics |
|-----------|-----------|
| ANALYZE | Glob all src files matching business logic patterns. For each, check corresponding test file existence |
| TECHNIQUES | Grep-based dimension detection: scan describe blocks for 6 dimensions (happy/negative/boundary/error/state/regression) |
| DESIGN | N/A — audit only, no test writing |
| EXECUTE | Run grep/read scans, compile compliance report |
| GATE | Report format below, no pass/fail — pure findings |

**Audit Procedure** (external oracle — AI does NOT self-assess):

```bash
# Step 1: Find all business logic source files
find src/ -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' -not -name '*.d.ts' -not -path '*/types/*' -not -path '*/constants/*'

# Step 2: For each src file, check test file existence
# Pattern: src/foo.ts → src/foo.test.ts OR tests/foo.test.ts OR __tests__/foo.test.ts

# Step 3: For each test file, grep 6 dimensions
grep -n -E 'describe\(.*(happy|negative|boundary|error|state|regression)' <test-file>
# Also check N/A annotations:
grep -n -E '//\s*N/A.*:' <test-file>

# Step 4: Detect anti-patterns
grep -n 'as unknown as' <test-file>                    # type bypass
grep -n 'vi\.mock(' <test-file>                         # whole-module mock count
grep -n "fetch.*mock.*\(\)" <test-file>                 # empty fetch mock
```

**Output format**:
```
## Test Audit Report — {project} ({date})

### Coverage Matrix
| Source File | Test File | Exists | HAPPY | NEG | BOUND | ERR | STATE | REGR |
|---|---|---|---|---|---|---|---|---|
| src/foo.ts | src/foo.test.ts | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ❌ |

### Missing Test Files
- src/bar.ts — NO corresponding test file

### Missing Dimensions
- src/foo.test.ts: boundary, regression

### Anti-Patterns Detected
- src/baz.test.ts:42 — `as unknown as Config` type bypass
- src/baz.test.ts:10 — whole-module vi.mock without partial

### Summary
- Files audited: X
- Test coverage: Y/X (Z%)
- Dimension compliance: A/B (C%)
- Anti-patterns: N findings
```

### author-separated

**Purpose**: Route test authoring to an independent subagent. Mitigates Self-Verification Paradox.

**When to use**: `complexity ≥ medium` tasks, OR when explicitly requested, OR when audit reveals poor dimension coverage on files the same agent implemented.

**Procedure**:

1. **Extract spec inputs** (from lore plan task or user request):
   - Function/method signatures (public API only)
   - Acceptance criteria
   - Input/output types (Zod schemas or TypeScript interfaces)
   - ⛔ Do NOT include implementation source code

2. **Dispatch test subagent**:
```
Agent(subagent_type="lore-implementer", isolation="worktree", prompt=`
  ## Task: Write tests for <module>

  ### Spec / Acceptance Criteria
  <paste AC from plan task>

  ### Function Signatures
  <paste public API signatures — types, params, return types>

  ### Constraints
  - DO NOT read implementation source files — test against spec behavior only
  - MUST cover all 6 dimensions: HAPPY, NEGATIVE, BOUNDARY, ERROR, STATE, REGRESSION
  - Use describe blocks named by dimension
  - Mark inapplicable dimensions with // N/A: <reason>
  - Follow AAA (Arrange-Act-Assert) pattern
  - Use fishery/faker for test data, msw/nock for external mocks

  ### Scaffold Template
  <paste 6-dimension scaffold from below>
`)
```

3. **Verify subagent output**: Run the tests (`npm test`), check dimension coverage with grep.

**6-Dimension Scaffold Template**:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
// import { Subject } from '../subject';

describe('Subject.method', () => {
  // Setup shared fixtures here
  // const subject = new Subject();

  describe('happy path', () => {
    it('returns expected result for valid input', () => {
      // Arrange → Act → Assert
    });
  });

  describe('negative cases', () => {
    it('rejects invalid input with descriptive error', () => {
      // expect(() => subject.method(invalid)).toThrow(SpecificError);
    });
  });

  describe('boundary values', () => {
    it('handles empty input', () => { /* [] / '' / 0 */ });
    it('handles maximum input', () => { /* MAX_SAFE_INTEGER / max length */ });
    it('handles off-by-one at limit', () => { /* limit-1, limit, limit+1 */ });
  });

  describe('error handling', () => {
    it('propagates dependency failure with context', () => {
      // vi.spyOn(dep, 'call').mockRejectedValue(new Error('network'));
      // await expect(subject.method()).rejects.toThrow('network');
    });
  });

  describe('state transitions', () => {
    // N/A: stateless pure function
    // OR:
    it('rejects action in invalid state', () => {
      // subject.setState('completed');
      // expect(() => subject.start()).toThrow(InvalidStateError);
    });
  });

  describe('regression', () => {
    // N/A: no known regressions
    // OR:
    it('handles edge case from issue #N', () => {
      // Specific repro from a historical bug
    });
  });
});
```

### unit

| Loop step | Specifics |
|-----------|-----------|
| ANALYZE | Function signatures, dependencies, side effects, branch paths |
| TECHNIQUES | EP for all params → BVA for boundaries → Decision Table for multi-condition logic → State Transition for stateful methods |
| DESIGN | Happy + boundary + error + state transitions. Property-based for pure functions. Mutation testing for critical paths |
| SETUP | Mock externals (msw/nock), fake timers, DI. Real DB only if testing query logic |
| GATE | Coverage + mutation score. Critical: 85% branch + 80% mutation |

**Example**: Pure function with validation

```typescript
import { describe, it, expect } from 'vitest';
import { calculateDiscount } from './pricing';

describe('calculateDiscount', () => {
  describe('happy path', () => {
    it.each([
      { tier: 'gold', amount: 100, expected: 85 },
      { tier: 'silver', amount: 100, expected: 90 },
      { tier: 'bronze', amount: 100, expected: 95 },
    ])('applies $tier discount: $amount → $expected', ({ tier, amount, expected }) => {
      expect(calculateDiscount(amount, tier)).toBe(expected);
    });
  });

  describe('boundary values', () => {
    it('handles zero amount', () => expect(calculateDiscount(0, 'gold')).toBe(0));
    it('handles MAX_SAFE_INTEGER', () => {
      expect(calculateDiscount(Number.MAX_SAFE_INTEGER, 'bronze')).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('rejects negative amount', () => {
      expect(() => calculateDiscount(-1, 'gold')).toThrow('Amount must be non-negative');
    });
    it('rejects invalid tier', () => {
      expect(() => calculateDiscount(100, 'diamond' as any)).toThrow();
    });
  });
});
```

### integration

| Loop step | Specifics |
|-----------|-----------|
| ANALYZE | Module interactions, API endpoints, data flow across services |
| TECHNIQUES | EP for API inputs → BVA for pagination/limits → Pairwise for multi-param endpoints |
| DESIGN | Happy + error + concurrency + idempotency + permission. API endpoint coverage tracking |
| SETUP | @testcontainers for DB/Redis, supertest for HTTP, real service instances preferred |
| GATE | Coverage + no leaked resources + API endpoint coverage ≥95% |

**Example**: API endpoint with supertest

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { seedTestData, cleanupTestData } from '../test-utils';

describe('POST /api/orders', () => {
  beforeAll(() => seedTestData());
  afterAll(() => cleanupTestData());

  describe('happy path', () => {
    it('creates order and returns 201', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ productId: 'prod-1', quantity: 2 });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ productId: 'prod-1', quantity: 2, status: 'pending' });
    });
  });

  describe('error handling', () => {
    it('returns 404 for non-existent product', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ productId: 'nonexistent', quantity: 1 });
      expect(res.status).toBe(404);
    });

    it('returns 401 without auth', async () => {
      const res = await request(app).post('/api/orders').send({ productId: 'prod-1', quantity: 1 });
      expect(res.status).toBe(401);
    });
  });

  describe('boundary values', () => {
    it('rejects quantity of 0', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${testToken}`)
        .send({ productId: 'prod-1', quantity: 0 });
      expect(res.status).toBe(400);
    });
  });

  describe('state transitions', () => {
    it('idempotent: duplicate request returns same order', async () => {
      const idempotencyKey = 'idem-123';
      const payload = { productId: 'prod-1', quantity: 1 };
      const res1 = await request(app).post('/api/orders')
        .set('Authorization', `Bearer ${testToken}`)
        .set('Idempotency-Key', idempotencyKey).send(payload);
      const res2 = await request(app).post('/api/orders')
        .set('Authorization', `Bearer ${testToken}`)
        .set('Idempotency-Key', idempotencyKey).send(payload);
      expect(res1.body.id).toBe(res2.body.id);
    });
  });
});
```

### contract

| Loop step | Specifics |
|-----------|-----------|
| ANALYZE | API schemas (OpenAPI/JSON Schema), MCP tool definitions, event payloads, provider-consumer boundaries |
| TECHNIQUES | Schema validation → Cross-Reference Consistency Testing (see `ai-native-testing.md`) |
| DESIGN | Schema validation tests, breaking change detection, version compatibility |
| SETUP | Pact or schema-based validators, mock provider/consumer |
| GATE | 100% schema match, no breaking changes without version bump |
| Tools | ajv (JSON Schema), @pact-foundation/pact, zod schema assertions |

**Example**: Zod schema contract test

```typescript
import { describe, it, expect } from 'vitest';
import { UserResponseSchema } from '../schemas/user';

describe('contract: /api/users/:id response', () => {
  it('response matches schema', async () => {
    const res = await request(app).get('/api/users/user-1');
    const parsed = UserResponseSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
  });

  it('error response matches error schema', async () => {
    const res = await request(app).get('/api/users/nonexistent');
    expect(res.body).toMatchObject({ error: expect.any(String), code: expect.any(String) });
  });
});
```

### strategy

| Loop step | Specifics |
|-----------|-----------|
| ANALYZE | Codebase scan: modules, complexity, change frequency, existing test coverage |
| TECHNIQUES | **MUST use `mcp__sequential-thinking__sequentialthinking`**: coverage analysis → risk areas → test type allocation → priority |
| DESIGN | Multi-perspective 5-agent risk assessment (see `references/mode-strategy.md`) |
| PERSIST | `create_doc(type="test-plan")` with: scope, risk matrix, test allocation, gates, artifact rules |
| Output | Test plan document + linked tasks for each test mode needed |

---

## Preferred Libraries

**Core**: msw/nock (API mocking), @faker-js/faker + fishery (test data), @testing-library/* (DOM), supertest (HTTP), @testcontainers/* (DB/service isolation), playwright (E2E)

**Advanced**: fast-check + @fast-check/vitest (PBT), zod-fast-check (Zod→Arbitrary), ajv (schema validation), @pact-foundation/pact (contract), Stryker (mutation)

**Mobile**: maestro MCP (Android flow automation), mobile-mcp (Android device control)

**CI**: Codecov (diff coverage), jest-junit/vitest-junit (JUnit XML), Knapsack Pro (test sharding)

## Mandatory Guards

### Mock Fidelity Rule
⛔ When mocking event payloads, API responses, or function return values:
1. **READ the actual emit/return site** in source code (grep for the emit call, find the return statement)
2. **Extract the real data structure** from that code — field names, types, presence/absence
3. **Use that structure in your mock** — not what the design spec says, not what seems logical
4. Never assume a payload field exists without verifying at the emit site
5. ⛔ **Every mock MUST have a comment citing the source**: `// Verified against src/events.ts:42`

**Why**: Guardian PM tests mocked `payload.type: 'message'` but the actual `message.sent` event has no `type` field — all 65 tests passed while the feature was broken in production. Mocks that don't match reality give false confidence.

### Mock Minimality Rule
⛔ Before adding any mock, answer these questions:
1. **Can I use the real dependency?** (in-memory DB, test container, real config) → prefer real
2. **What bug am I HIDING by mocking this?** — If the real dependency could fail in production, mocking hides that risk
3. **Does removing this mock change any test outcome?** — If no → the mock is unnecessary noise

**Red flag**: If >50% of a test file's lines are mock setup, the tests are probably testing mocks, not behavior.

### E2E Strategy Rule — User-Facing Features
⛔ When the implemented feature is **user-perceivable** (message triggers response, UI changes, API returns visible result):
1. **agent-browser E2E is MANDATORY** — test against a real running dev server, not mocks
2. Mock-based unit/integration tests are **supplementary** (fast regression), not a substitute
3. E2E must verify the **full chain**: user action → backend processing → visible result

**When to use agent-browser**: feature involves user sending a message and seeing a response, UI rendering changes, form submission with visible feedback, or any flow where "the user would notice if it's broken."

**When mock tests suffice**: pure utility functions, internal data transformations, algorithm correctness — things with no user-visible surface.

### Schema Migration Rule
⛔ When tests involve DB schema changes on **existing tables** (ALTER TABLE, not CREATE TABLE):
1. Tests must cover BOTH "new data" path AND "existing data" path
2. Verify backfill migration works on pre-existing rows
3. Never assume DB defaults will apply — verify with an actual query

---

## Principles

1. **Tests exist to find bugs**: A test that passes on buggy code is worse than no test. The goal is defect detection, not green checkmarks.
2. **Spec-first, code-second**: Derive expected behaviors from spec/AC BEFORE reading implementation. This prevents tautological tests.
3. **Test pyramid**: 70% unit / 20% integration / 10% e2e. Test behavior, not implementation.
4. **Systematic derivation**: Every test case traceable to a technique (EP/BVA/DT/ST/PBT), not ad-hoc.
5. **Requirements traceability**: Every AC has ≥1 test. Every test references an AC or risk item.
6. **AI-native testing**: Leverage pattern recognition, cross-file analysis, property generation, and metamorphic relations.
7. **Sustainability**: Follow anti-patterns catalog (`references/test-maintainability.md`). DAMP > DRY for tests. AAA structure (Arrange-Act-Assert).
8. **Mock fidelity**: Every mock payload must be verified against the actual emit/return site in source code.
9. **Real E2E for user-facing features**: agent-browser E2E against real dev server, not just mock tests.
10. **Different inputs, different outputs**: Every happy-path function must be tested with ≥2 input sets producing different outputs. This defeats hardcoded-return implementations.

## ⛔ AI Testing Anti-Patterns (The lore-implementer Writing Tests Must Avoid)

| Anti-Pattern | What It Looks Like | Why It's Dangerous | Fix |
|---|---|---|---|
| **Tautological Test** | Expected value copied from source code (`?? 'guest'` → assert `'guest'`) | Validates bugs as features | Derive expected value from SPEC, not code |
| **Mock Echo** | Mock returns X, code passes X through, test asserts X | Tests the mock, not the code | Reduce mocks; test with real dependencies |
| **Happy-Only** | All tests pass, zero error/rejection path tests | Entire failure surface untested | ≥30% of tests must verify error paths |
| **Hardcoded-Passable** | All tests would pass if implementation were `return "fixed"` | Can't distinguish working code from stub | Use ≥2 different inputs with different expected outputs |
| **Implementation Mirror** | Test logic mirrors if/else structure of source code | Test is a rewrite of the code, catches nothing | Test from spec, not from code structure |
| **Over-Mock** | >50% of test lines are mock setup; removing mocks doesn't change outcomes | Tests prove mocks work, not code | Use real deps; mock only external boundaries |
| **Fallback Blessing** | Tests assert that `?? default` returns `default` without checking if spec says to throw | Silently approves error-hiding patterns | For every fallback, verify spec intent: should it fallback or reject? |

## Also use when

Other phrases that route here: 'frontend test', 'security test', 'performance test', 'eval', and questions about test infrastructure or coverage. Authors or audits automated suites with six-dimension coverage and external oracles.
