---
id: SPEC-013
type: spec
role: spec
title: "Eval Framework"
status: active
priority: medium
phase: P1
created: 2026-06-24
updated: 2026-06-24
tags: [eval, observability, phase-1]
parent: PRD-001
links:
  - {id: SPEC-007, type: consumes, note: "migration-coverage scenario calls MigrationService"}
  - {id: SPEC-012, type: relates-to, note: "Eval consumes telemetry data in future scenarios"}
  - {id: SPEC-003, type: implements, note: "lore eval CLI command"}
---

# SPEC-013 — Eval Framework

---

## 1. Purpose

Define a lightweight, extensible eval framework for validating corpus operations. Evals are executable scenarios that produce a structured pass/fail result. They complement unit tests by operating end-to-end against real data (e.g., the actual `docs/requirements/` directory).

MVP delivers one scenario (`migration-coverage`) and the CLI surface to run it.

---

## 2. Scenario Interface

Each eval scenario is a pure async function:

```typescript
async function runScenario(
  input: ScenarioInput,
  app: App,
): Promise<ScenarioResult>
```

Where `ScenarioResult` always includes at minimum:

```typescript
interface BaseScenarioResult {
  passed: boolean;    // single pass/fail gate for CI
  duration_ms: number;
}
```

Invariants for all scenarios:
- Never throws — errors (missing dirs, service failures) are captured in `passed=false`
- Idempotent given the same `app` state and inputs
- Does not mutate external state other than the provided `app`'s store

---

## 3. Implemented Scenarios (MVP)

### 3.1 migration-coverage

**File**: `src/eval/scenarios/migration-coverage.ts`  
**CLI**: `lore eval migration --from <dir>`

Validates that a v1 corpus import is complete and link-consistent.

**Pass condition (K2 — idempotent-safe)**:
```
(imported + already_existed) === expected_files && links_broken === 0
```

Rationale: migration is idempotent — docs already present in the store are counted as
`already_existed` (not failures). A re-run against an already-populated corpus yields
`imported=0, already_existed=N` which still satisfies the gate.

**Result shape**:
```typescript
interface MigrationCoverageResult {
  source_dir: string;
  expected_files: number;    // .md files with valid YAML frontmatter (parseable)
  imported: number;          // migrationService.execute().imported (newly inserted)
  already_existed: number;   // migrationService.execute().already_existed (idempotent skips)
  links_created: number;     // migrationService.execute().link_resolution.created
  links_broken: number;      // migrationService.execute().link_resolution.broken
  type_distribution: Record<string, number>;  // from corpus after migration
  duration_ms: number;
  passed: boolean;           // (imported + already_existed) === expected_files && links_broken === 0
}
```

**Edge cases**:
- Non-existent source dir → `passed=false`, `expected_files=0`
- Empty source dir → `passed=true`, `imported=0`, `already_existed=0`, `links_broken=0`
- Migration service returns error → `passed=false`
- Re-run on already-populated store → `imported=0`, `already_existed=N`, `passed=true`

---

## 4. CLI Surface

```
lore eval migration --from <dir> [--json]
```

Exit codes follow SPEC-003 §5 conventions:
- `0` — scenario passed
- `1` — scenario failed or internal error
- `2` — bad arguments

The eval command is registered as `lore eval` with `migration` as a subcommand, making it extensible for future scenarios.

---

## 5. File Layout

```
src/eval/
  index.ts                         ← public re-exports
  scenarios/
    migration-coverage.ts          ← migration scenario impl
src/adapters/cli/commands/
  eval.ts                          ← CLI command (eval parent + migration subcommand)
```

---

## 6. CI Integration

The eval scenario is designed for CI dogfood. The canonical invocation against the lore repo itself:

```bash
lore eval migration --from docs/requirements --skip-secret-scan
# expect: exit 0, (imported + already_existed)=14, links_broken=0, passed=true
# fresh corpus:  imported=14, already_existed=0
# re-run:        imported=0,  already_existed=14  (still passed=true)
```

This is verified as part of AC-C5 (end-to-end smoke test).

---

## 7. Future Scenarios (not in MVP)

| Scenario | Description | Pass Condition |
|----------|-------------|----------------|
| `fts-recall` | FTS search recall rate against known query/expected pairs | recall >= 0.8 |
| `placeholder-parse` | MDX placeholder resolution success rate | all known placeholders resolve |
| `tree-consistency` | Verify no orphan docs or broken parent links | 0 broken links |
| `link-integrity` | All doc links point to existing non-deleted docs | 0 dangling links |
| `type-distribution` | Corpus has expected type distribution | configurable thresholds |

Each future scenario follows the same pattern: async function + structured result + `passed: boolean` + CLI subcommand.

---

## 8. Relationship to Telemetry (SPEC-012)

Eval scenarios and telemetry are complementary:
- **Telemetry** (SPEC-012): captures per-call latency/error data during normal operation
- **Evals** (SPEC-013): run on-demand to validate correctness of corpus operations

Future: eval runs could be correlated with telemetry events by session ID to measure regression in latency across runs.

---

## 9. Test Coverage Requirements

See `tests/unit/eval/migration-coverage.test.ts` for coverage:
- HAPPY: runs on `docs/requirements`, imported=14, already_existed=0, passed=true
- NEGATIVE: empty dir → passed=true (degenerate valid case)
- ERROR: non-existent dir → passed=false (no throw)
- STATE: re-running with same inputs produces deterministic results
- STATE (K2): second run on same store → imported=0, already_existed=N, passed=true
