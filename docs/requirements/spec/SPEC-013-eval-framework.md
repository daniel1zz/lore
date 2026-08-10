---
id: SPEC-13
type: spec
role: spec
title: "Eval Framework"
status: active
priority: medium
created: 2026-06-24
updated: 2026-07-14
tags: [eval, observability, phase-1]
parent: PRD-001
links:
  - {id: SPEC-7, type: relates-to}
  - {id: SPEC-12, type: relates-to}
  - {id: SPEC-3, type: implements}
---
# SPEC-013 — Eval Framework

---

## 1. Purpose

Define a lightweight, extensible eval framework for validating corpus operations. Evals are executable scenarios that produce a structured pass/fail result. They complement unit tests by operating end-to-end against real data (e.g., the actual `docs/requirements/` directory).

MVP delivers six scenarios (`migration-coverage`, `tree-consistency`, `link-integrity`, `type-distribution`, `fts-recall`, `placeholder-parse`) and the CLI surface to run them.

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

## 3. Implemented Scenarios

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

### 3.2 tree-consistency

**File**: `src/eval/scenarios/tree-consistency.ts`  
**CLI**: `lore eval tree`

Validates the corpus parent-tree against three structural invariants:
1. No orphan docs — every non-root doc must have a `parent_id` pointing to an existing, non-deleted document.
2. No cycles — no parent chain may contain a cycle.
3. No invalid parent types — every child's parent must satisfy `PARENT_TYPE_CONTRACT` from `src/core/doc-type-rules.ts`.

Implementation delegates to `app.treeCheckService.checkTree()` with a permissive minimal blueprint (no required children), then maps drift kinds: `"orphan"` → orphans, `"cycle"` → cycles, `"misplaced"` → invalid_parent_types.

**Pass condition**:
```
orphans === 0 && cycles === 0 && invalid_parent_types === 0
```

**Result shape**:
```typescript
interface TreeConsistencyResult {
  total_docs: number;
  orphans: number;               // docs with missing/invalid parent
  cycles: number;                // distinct parent-chain cycles detected
  invalid_parent_types: number;  // PARENT_TYPE_CONTRACT violations
  duration_ms: number;
  passed: boolean;
  details: {
    orphan_ids: string[];        // up to 10 sampled IDs
    cycle_paths: string[][];     // up to 10 sampled cycle paths
    invalid_pairs: Array<{
      child_id: string;
      parent_id: string;
      child_type: string;
      parent_type: string;
    }>;
  };
}
```

**Edge cases**:
- Empty corpus → `passed=true` (degenerate)
- Store failure → `passed=false`, all counts 0

---

### 3.3 link-integrity

**File**: `src/eval/scenarios/link-integrity.ts`  
**CLI**: `lore eval links`

Validates that all non-parent links in the corpus point to valid, live documents.

**Note on detection scope**: The implementation uses `corpusService.get(id)` per doc, which surfaces links visible at the service layer. Links to soft-deleted docs are detected (the store returns soft-deleted records). Truly dangling links (pointing to hard-missing doc IDs) are silently dropped by the service layer; detecting them would require raw store access (no new store methods were added per SPEC-013 constraints).

**Pass condition**:
```
dangling === 0 && to_deleted === 0 && self_loops === 0
```

**Result shape**:
```typescript
interface LinkIntegrityResult {
  total_links: number;    // unique non-parent link edges observed
  dangling: number;       // links to hard-missing docs (service-layer detectable only)
  to_deleted: number;     // links to soft-deleted docs
  self_loops: number;     // links where from_id === to_id
  duration_ms: number;
  passed: boolean;
  details: {
    dangling_links: Array<{from_id: string; to_id: string; type: string}>;     // top-10
    deleted_target_links: Array<{from_id: string; to_id: string; type: string}>; // top-10
    self_loop_links: Array<{from_id: string; type: string}>;                    // top-10
  };
}
```

**Edge cases**:
- Empty corpus or no links → `passed=true`, `total_links=0`
- Store failure → `passed=false`

---

### 3.4 type-distribution

**File**: `src/eval/scenarios/type-distribution.ts`  
**CLI**: `lore eval types`

Checks that each `DocType`'s count in the live corpus falls within configurable min/max thresholds. Used to assert "is every type represented at a reasonable level?"

Unknown types in custom thresholds are reported as a violation with `reason="unknown_type"` (fail loud — not silently skipped).

**Default thresholds** (used when no custom input is provided):
```typescript
const DEFAULT_THRESHOLDS = [
  { type: "prd",       min: 1 },  // at least one PRD required
  { type: "spec",      min: 1 },  // at least one spec required
  { type: "adr",       min: 0 },  // ADRs optional
  { type: "plan",      min: 0 },
  { type: "knowledge", min: 0 },
  { type: "task",      min: 0 },
];
```

**Pass condition**:
```
violations.length === 0
```

**Result shape**:
```typescript
interface TypeDistributionResult {
  distribution: Record<string, number>;  // actual count per live type
  violations: Array<{
    type: string;
    actual: number;
    min?: number;
    max?: number;
    reason: "below_min" | "above_max" | "unknown_type";
  }>;
  duration_ms: number;
  passed: boolean;
}
```

**CLI note**: `--config <yaml>` for custom thresholds is deferred to a future iteration. The scenario function accepts `TypeDistributionInput` for programmatic/SDK use.

**Edge cases**:
- Empty corpus + default thresholds → `passed=false` (prd min=1 violated)
- Unknown type in custom thresholds → `passed=false`, `reason="unknown_type"` (not silent skip)
- Store failure → `passed=false`

---

### 3.5 fts-recall

**File**: `src/eval/scenarios/fts-recall.ts`
**CLI**: `lore eval fts`

Measures recall@K of `corpusService.search()` against a curated query/expected-slug fixture. Each query carries a `query` string, an `expected_slugs` list, and an optional `top_k` (default 5). Recall per query = `|retrieved_top_k ∩ resolved_expected_ids| / resolved_expected_count`. `avg_recall` is the arithmetic mean over all queries.

The fixture lives inline as `DEFAULT_FTS_QUERIES` and is calibrated against the lore self-corpus (`docs/requirements/`). Custom fixtures and thresholds are accepted via the `FtsRecallInput` programmatic surface; a `--queries <path>` CLI flag is deferred (mirrors `--config` on `types`).

**Pass condition**:
```
avg_recall >= pass_threshold && every per_query.failed === false
```
Default `pass_threshold = 0.8`. A single search returning a store error trips `passed=false` even if other queries hit 1.0.

**Result shape**:
```typescript
interface FtsRecallResult {
  total_queries: number;
  avg_recall: number;            // 0..1
  pass_threshold: number;        // default 0.8
  per_query: Array<{
    query: string;
    expected_slugs: string[];
    resolved_expected_count: number;  // slugs that exist in the corpus
    retrieved_top_k: number;          // top_k applied for this query
    hits: number;                     // |retrieved ∩ resolved_expected|
    recall: number;                   // 0..1
    failed: boolean;                  // search returned err
    degenerate: boolean;              // resolved_expected_count === 0
  }>;
  duration_ms: number;
  passed: boolean;
}
```

**Edge cases**:
- Empty queries → `total_queries=0`, `avg_recall=0`, `passed=false` (0 < 0.8)
- All expected_slugs missing from corpus → `per_query[i].degenerate=true`, `recall=0`
- Search returns err for one query → `per_query[i].failed=true`, `passed=false`
- FTS5-special tokens (`-`, `*`, `?`, parens, colons) are safe in query strings — `SQLiteStore.search` / `TursoStore.search` escape arbitrary input via the `escapeFtsQuery` helper in `store-shared.ts` (each whitespace-separated piece is wrapped in FTS5 phrase quotes, with embedded `"` doubled). Phrase semantics: each piece must appear as a consecutive token sequence after FTS5 tokenization, and all pieces must appear (implicit AND). Hyphenated terms like `append-only` therefore match the consecutive token pair `[append, only]` in any source doc (FTS5's unicode61 tokenizer strips the hyphen during indexing)

---

### 3.6 placeholder-parse

**File**: `src/eval/scenarios/placeholder-parse.ts`
**CLI**: `lore eval placeholders`

Scans every live doc for self-closing MDX placeholder tags (regex `/<([A-Z][A-Za-z0-9]*)(\s[^>]*)?\s*\/>/g`) and feeds each match-containing doc through `outlineService.resolve()`. Aggregates how many components resolve as whitelisted vs. how many produce "unknown component stripped" warnings vs. how many docs return a store/resolve error.

**Pass condition**:
```
unknown_warnings === 0 && resolution_errors === 0
```
Read: every detected placeholder is in the OutlineService whitelist AND resolved without storage failure. "Resolved" includes graceful-degradation cases (e.g. `<Embed id="MISSING" />` returns `null` data without raising a warning).

**Result shape**:
```typescript
interface PlaceholderParseResult {
  total_docs_scanned: number;
  docs_with_placeholders: number;
  total_placeholders_found: number;    // raw regex hit count
  resolved_total: number;              // sum of whitelisted resolvedComponents
  unknown_warnings: number;            // sum of "unknown component stripped" warnings
  resolution_errors: number;           // docs whose resolve() returned err
  duration_ms: number;
  passed: boolean;
  details: {
    unknown_components: Array<{ doc_id: string; component: string }>;     // top-10
    resolution_error_docs: Array<{ doc_id: string; error_code: string; message: string }>;  // top-10
  };
}
```

**Edge cases**:
- Empty corpus → `passed=true` (vacuously — no docs, no placeholders)
- Soft-deleted docs are excluded (list() filter)
- `corpusService.get(id)` failure on a single doc → that doc is skipped (not counted as `resolution_errors`)
- `corpusService.list()` failure → `passed=false`, all counts 0
- Authoring caveat: MDX-shaped tokens used **illustratively** inside markdown table cells will still be detected by the regex. Authors should escape such illustrations using HTML entities (`&lt;Foo /&gt;`) so they don't get evaluated as live placeholders. The fenced ` ```mdx ` example block in SPEC-004 §2 is intentional and continues to resolve cleanly because its tags are whitelisted.

---

## 4. CLI Surface

```
lore eval migration --from <dir> [--json]
lore eval tree [--json]
lore eval links [--json]
lore eval types [--json]
lore eval fts [--json]
lore eval placeholders [--json]
```

Exit codes follow SPEC-003 §5 conventions:
- `0` — scenario passed
- `1` — scenario failed or internal error
- `2` — bad arguments

The `--json` flag outputs the full result as `{ ok: boolean, data: ScenarioResult }`.

---

## 5. File Layout

```
src/eval/
  index.ts                         ← public re-exports (all 6 scenarios)
  scenarios/
    migration-coverage.ts          ← migration scenario impl
    tree-consistency.ts            ← tree-consistency scenario impl
    link-integrity.ts              ← link-integrity scenario impl
    type-distribution.ts           ← type-distribution scenario impl
    fts-recall.ts                  ← fts-recall scenario impl + DEFAULT_FTS_QUERIES
    placeholder-parse.ts           ← placeholder-parse scenario impl
src/adapters/cli/commands/
  eval.ts                          ← CLI command (eval parent + 6 subcommands)
tests/unit/eval/
  migration-coverage.test.ts
  tree-consistency.test.ts
  link-integrity.test.ts
  type-distribution.test.ts
  fts-recall.test.ts
  placeholder-parse.test.ts
```

---

## 6. CI Integration

Canonical CI dogfood invocation against the lore repo itself:

```bash
# migration scenario (existing)
lore eval migration --from docs/requirements --skip-secret-scan
# expect: exit 0, (imported + already_existed)=14, links_broken=0, passed=true

# tree-consistency (new)
lore eval tree
# expect: exit 0, orphans=0, cycles=0, invalid_parent_types=0

# link-integrity (new)
lore eval links
# expect: exit 0, dangling=0, to_deleted=0, self_loops=0

# type-distribution (new)
lore eval types
# expect: exit 0 (prd>=1, spec>=1 satisfied by the 14-doc corpus)

# fts-recall (new)
lore eval fts
# expect: exit 0, avg_recall >= 0.8 against DEFAULT_FTS_QUERIES (7 calibrated query/slug pairs)

# placeholder-parse (new)
lore eval placeholders
# expect: exit 0, unknown_warnings=0, resolution_errors=0
```

---

## 7. Future Scenarios

The §7 backlog is empty as of 2026-06-25 — both `fts-recall` and `placeholder-parse` have been promoted to §3.5 and §3.6. New scenarios proposed after this point should be added to this section before implementation and follow the established pattern: async function + Zod-validated result + `passed: boolean` + CLI subcommand + six-dimension test coverage.

---

## 8. Relationship to Telemetry (SPEC-012)

Eval scenarios and telemetry are complementary:
- **Telemetry** (SPEC-012): captures per-call latency/error data during normal operation
- **Evals** (SPEC-013): run on-demand to validate correctness of corpus operations

Future: eval runs could be correlated with telemetry events by session ID to measure regression in latency across runs.

---

## 9. Test Coverage Requirements

| Test File | Dimensions |
|-----------|-----------|
| `tests/unit/eval/migration-coverage.test.ts` | HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE |
| `tests/unit/eval/tree-consistency.test.ts` | HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION |
| `tests/unit/eval/link-integrity.test.ts` | HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION |
| `tests/unit/eval/type-distribution.test.ts` | HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION |
| `tests/unit/eval/fts-recall.test.ts` | HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION |
| `tests/unit/eval/placeholder-parse.test.ts` | HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION |

All tests use `InMemoryStore` (no SQLite, no file I/O) and run under vitest.

## Code anchors

- packages/lore/src/eval/
