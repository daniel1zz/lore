# AI-Native Testing Patterns

**Purpose**: Testing patterns that leverage AI agent's unique capabilities — pattern recognition, cross-file analysis, documentation reading, and systematic generation.

## 1. Property Generation from Code Analysis

**Trigger**: AI reads a Zod schema, TypeScript interface, or function with expressible invariants.

**Steps**:
1. Parse Zod schema → extract field constraints (`.min()`, `.max()`, `.regex()`, `.enum()`)
2. For each constraint → generate fast-check `Arbitrary`
3. Synthesize property: "round-trip through `Schema.parse()` must succeed and return equal output"
4. Generate negative properties from `.refine()` calls

**Outcome**: Property-based tests exercising schema boundaries at scale (100+ samples) with zero manual data authoring.

---

## 2. Mutation Survivor Analysis

**Trigger**: Mutation score gate fails, or after initial test suite for critical logic.

**Steps**:
1. Run Stryker → parse report JSON for surviving mutants
2. Classify each by risk: business logic mutation = Critical; formatting = Low
3. For each Critical/High survivor → generate targeted kill-test
4. Example: mutant changes `<` to `<=` → test boundary case that distinguishes `<` from `<=`

**Outcome**: Targeted tests that eliminate highest-risk mutants. Humans can't efficiently analyze 50+ survivors; AI does it mechanically.

---

## 3. Pattern-Based Test Generation

**Trigger**: AI recognizes code patterns during ANALYZE step.

| Code Pattern | Test Template |
|-------------|--------------|
| Null guard: `if (!x) throw` | Test null, undefined, empty, valid |
| Mutual exclusion: `if (a && b) throw` | Test both-present, one-present, neither |
| State machine: status enum + transition map | N×N matrix: valid pass, invalid throw |
| DAG validation: cycle detection | Generate diamond, chain, cycle topologies |
| Registry: `if (exists) return` | Test double-registration is safe (idempotent) |
| Retry logic: `while (retries--)` | Test success on 1st, mid, last, and exceed-max |
| Cache: `if (cached) return cached` | Test cold miss, warm hit, invalidation, stale |

**Steps**:
1. During ANALYZE, tag each function with recognized patterns
2. For each pattern → apply its test template
3. Emit `describe/it` skeletons with assertion logic

---

## 4. Test Oracle from Documentation

**Trigger**: AI finds JSDoc, README, lore corpus docs, or inline constraint objects linked to code under test.

**Steps**:
1. Read documentation: e.g., `LINK_RULES` with `constraint`, `example`, `error_hint` fields
2. Parse `example` fields as expected passing scenarios
3. Parse `constraint` to derive rejection cases
4. Parse `error_hint` to verify error messages match
5. Generate tests asserting documented behavior = actual behavior

**Outcome**: Executable documentation tests. When code drifts from docs (or docs from code), tests fail — catching a class of bugs that neither code review nor unit tests normally detect.

---

## 5. Metamorphic Testing

**Trigger**: Function with complex output where exact-value assertion is fragile (search, ranking, aggregation).

| Metamorphic Relation | Example |
|---------------------|---------|
| **Idempotency** | `search(q)` twice → same results |
| **Create-Delete Identity** | Create then delete → state unchanged |
| **Symmetry** | `addLink(A, B)` → A's outgoing includes B AND B's incoming includes A |
| **Monotonicity** | Every update increments version: `v1 < v2 < v3` |
| **Stability** | `slugify(slugify(text)) === slugify(text)` |

**Steps**:
1. Identify functions where output changes frequently but relationships are stable
2. Express relations as property-based tests
3. Run with randomized inputs via fast-check

---

## 6. Self-Healing Test Maintenance

**Trigger**: Test suite fails after code change, and failure pattern matches known maintenance issue.

**Classification**:
| Failure Type | AI Action |
|-------------|-----------|
| String literal mismatch (error message changed) | Auto-update expected string |
| Structural change (field renamed/added) | Update assertions to new shape |
| Behavioral change (logic actually changed) | Flag for human review — real regression |

**Outcome**: AI distinguishes "test is stale" from "code is broken" — reducing maintenance burden by avoiding unnecessary human triage of non-behavioral failures.

---

## 7. Cross-Reference Consistency Testing

**Trigger**: Project has multiple truth sources that should agree (schemas, interfaces, constants, configs).

| Check | What AI Verifies |
|-------|-----------------|
| Schema-type alignment | Zod schema fields match TypeScript interface fields |
| Enum exhaustiveness | Status enum has N values → transition map has N keys |
| Registry-constant sync | All maps (`TYPE_CATEGORY_MAP`, `TYPE_PREFIX_MAP`) cover every type |
| Link type completeness | Direction rules cover all link types |
| Config-env alignment | Config schema fields match environment variable usage |

**Steps**:
1. Extract all enum/const arrays as canonical truth sets
2. For each map/switch/record referencing those enums → verify exhaustive coverage
3. Generate one test per consistency relationship

**Outcome**: Catches "added X but forgot to update Y" bugs — the most common class of multi-file inconsistency. AI's ability to read across 10+ files simultaneously makes this trivial.

---

## When to Apply

| Pattern | Apply During | Priority |
|---------|-------------|----------|
| Property Generation | unit/integration test writing | Always for code with Zod schemas |
| Mutation Analysis | After initial test suite, gate failure | When mutation score < target |
| Pattern-Based Gen | unit test writing (ANALYZE step) | Always — free coverage |
| Doc Oracle | integration testing, after spec exists | When docs/specs available |
| Metamorphic | Testing search, ranking, aggregation | When exact output is non-deterministic |
| Self-Healing | Test maintenance, after code refactor | On test failure triage |
| Cross-Reference | Before release, after schema changes | When multiple truth sources exist |
