# CI/CD Test Pipeline Architecture

**Purpose**: Map test types to pipeline stages for continuous testing integration.

## Pipeline Stage Model

```
PRE-COMMIT (local, <10s)
  → lint (staged files) + type-check + affected unit tests

PR/BRANCH (CI, <10min)
  → full unit + integration + contract + affected E2E + diff coverage

MAIN/MERGE (CI, <30min)
  → full E2E + visual regression + cross-browser + full contract verification

NIGHTLY (scheduled, unbounded)
  → performance + security + soak/stress + full mutation testing

RELEASE (triggered, <15min + monitoring)
  → smoke suite + canary verification + rollback readiness
```

## Feedback Time Budgets

| Stage | Budget | Rationale |
|-------|--------|-----------|
| Pre-commit | **< 10s ideal, < 30s max** | Beyond 30s developers skip the hook |
| PR | **< 5-10 min** | PRs waiting >10 min: 50% context-switch rate |
| Main | **< 20-30 min** | DORA elite: <15 min total pipeline |
| Nightly | **< 2h** (practical) | Must finish before morning review |
| Release | **< 15 min** (smoke) | + canary monitoring window (15 min–24h) |

## Stage → Test Type Mapping

| Test Type | Pre-commit | PR | Main | Nightly | Release |
|-----------|-----------|-----|------|---------|---------|
| Lint + Type-check | ✅ staged | ✅ all | ✅ | — | — |
| Unit | ✅ affected | ✅ full | ✅ | — | — |
| Integration | — | ✅ full | ✅ | — | — |
| Contract | — | ✅ consumer | ✅ provider | — | — |
| E2E | — | ✅ affected | ✅ full matrix | — | ✅ smoke |
| Visual regression | — | — | ✅ | — | — |
| Performance | — | — | — | ✅ load/stress | — |
| Security (SAST/SCA) | — | ✅ quick | ✅ | ✅ full DAST | — |
| Mutation | — | — | — | ✅ | — |
| Soak/Chaos | — | — | — | ✅ | — |

## Parallelization Strategies

### Test Sharding (CI multi-node)

| Strategy | Pros | Cons |
|----------|------|------|
| **Timing-based** (best) | Equal-time shards, optimal balance | Requires history; Knapsack Pro, `--shard` |
| **File-name hash** | Deterministic, no history needed | Uneven shard times |
| **Round-robin** | Simplest | Poorest balance |

### Selective Execution

- **Monorepo**: Turborepo/Nx `--affected` (dependency graph analysis)
- **Single repo**: `vitest --changed` (git diff-based)
- **Custom**: source file → test file registry (static analysis or naming convention)

### In-Process Parallelism

- `vitest --pool=threads` — worker threads (fastest for unit, shared memory)
- `vitest --pool=forks` — process isolation (safer for integration)
- `jest --maxWorkers=50%` — CPU heuristic; avoid OOM on CI
- `playwright workers: CI ? 2 : 4` — CI runners have fewer cores

## Test Result Reporting

| Channel | Tool | Use |
|---------|------|-----|
| **JUnit XML** | `vitest --reporter=junit` / `jest-junit` | Universal CI interchange |
| **Coverage** | `lcov` / `cobertura` → Codecov / Coveralls | Diff coverage gate |
| **PR annotations** | GitHub Actions problem matchers + Codecov inline | Uncovered lines on PR |
| **Failure alerts** | PR: status checks block merge. Main: Slack P0 alert | Broken main = immediate fix |
| **Nightly digest** | Scheduled summary → Slack/email | Morning review of perf/security results |

## Enhanced Coverage Models

### Requirements Coverage (AC Traceability)

- Tag tests with AC identifiers: `describe("AC-3.1: user can reset password")`
- Build traceability matrix: `AC-ID → [test-1, test-2] → PASS/FAIL`
- **Threshold**: 100% of ACs must have ≥1 test

### Risk Coverage

- Map risk items (from strategy mode) → specific tests
- Coverage = `risks with tests / total identified risks`
- **Threshold**: 100% Critical/High, ≥80% Medium

### API Endpoint Coverage

- Parse route definitions → cross-reference with test targets
- **Threshold**: ≥95% public endpoints, 100% for auth/payment/PII endpoints

### Mutation Score (Tiered)

| Criticality | Threshold |
|------------|-----------|
| Critical business logic (payments, auth) | ≥ 80% |
| Core domain logic | ≥ 60% |
| Utility / infrastructure | ≥ 40% |
| Generated / boilerplate | Exclude |

### Diff Coverage (New Code)

- Measure coverage only on lines changed in current PR
- **Threshold**: ≥80% on new/changed lines
- Tools: Codecov `patch`, `diff-cover`, SonarQube "New Code"
- Most impactful single gate: fair (no legacy penalty), enforceable, incentivizes testing new code
