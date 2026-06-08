---
id: PLAN-001
type: plan
role: plan
title: "Phase 1 Implementation — CLI + Local Store"
status: draft
priority: critical
phase: P1
created: 2026-06-08
updated: 2026-06-08
tags: [phase-1, implementation, cli, local-store]
parent: PRD-001
links:
  - {id: PRD-001, type: implements}
  - {id: SPEC-001, type: implements}
  - {id: SPEC-002, type: implements}
  - {id: SPEC-003, type: implements}
  - {id: SPEC-004, type: implements}
  - {id: SPEC-005, type: implements}
  - {id: SPEC-006, type: implements}
  - {id: SPEC-007, type: implements}
governance_mode: attended
strategy: interface-first
---

# PLAN-001: Phase 1 Implementation — CLI + Local Store

## Overview

Implements Lore Phase 1 (M1-M3): CLI binary + local SQLite store. Delivers a working `lore` CLI that replaces DocMan v1 for multi-agent use.

**Strategy**: Interface-First decomposition.
- Phase A: Types + interfaces + store (serial foundation)
- Phase B: 5 service implementations (ALL parallel)
- Phase C: CLI adapter + integration (serial)
- Phase D: Bun compile + dogfood + polish

**Estimated duration**: 8 session-units (critical path: A→B.longest→C→D)

## Invariants

1. **Service layer contains ALL business logic** — adapters have zero logic beyond parse/format
2. **Every write creates a version snapshot** — no silent mutations
3. **All service methods return Result<T, LoreError>** — no thrown exceptions crossing service boundary
4. **StoreInterface is the only storage access path** — services never import SQLite directly
5. **Tests use InMemoryStore** — service tests must not touch filesystem
6. **Slug + ULID dual-key** — every doc has both, both are valid lookup keys

## Risk Register

| ID | Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | bun:sqlite incompatible with Bun compile | H | M1 tech spike fails | Phase A includes compile validation | Fallback to better-sqlite3 or Deno compile |
| R2 | MDX parsing (remark/unified) too heavy for <200ms cold start | M | NFR-1 fails after integration | Lazy-load MDX parser via dynamic import | Defer MDX to warm path only; cold commands skip resolution |
| R3 | FTS5 triggers cause write latency > 50ms at 500 docs | L | Benchmark fails | Phase A store tests include perf benchmark | Async FTS sync instead of trigger-based |
| R4 | Slug collision with auto-generated slugs | L | Two docs with similar titles | Collision resolution: append -2, -3 | User can rename via `lore set --slug` |

**[RISK_REGISTER]** 4 risks identified: 1H / 1M / 2L

## Tech Stack (researched)

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Bun | Single binary compile, built-in SQLite, fast startup (validate in A.1) |
| SQLite | bun:sqlite | Zero dependency, built into Bun runtime. Fallback: better-sqlite3 |
| Validation | Zod | Per CLAUDE.md rules. Type-safe runtime validation at service boundary |
| ULID | ulidx | Lightweight, TypeScript-native, monotonic ULID generation |
| Slug | Custom (10 lines) | Simple `slugify(type + title)` — no library needed for kebab-case |
| MDX Parse | remark-parse + remark-mdx | Standard unified ecosystem. Lazy-loaded to protect cold start |
| Diff | diff (npm) | Lightweight unified diff. Used by VersionService |
| YAML | yaml (npm) | Config parsing for `.lore/config.yaml` |
| CLI Parse | citty (unjs) | Lightweight, sub-command native, TypeScript-first. Alternative: commander |
| Test | Vitest | Fast, Bun-compatible, watch mode, built-in coverage |

## Task Tree

### Phase A: Foundation (serial)

```
A.1 [Implement] Project scaffolding + tech spike
    Estimate: M
    Approach: Bun init + tsconfig + Vitest setup + Bun compile validation
    Source: PRD-001 §6 M1, SPEC-001 §6
    owns_files: package.json, tsconfig.json, vitest.config.ts, bunfig.toml, src/index.ts
    AC:
    - `bun build --compile` produces working binary
    - Binary cold-start < 200ms on macOS (validate NFR-1 feasibility)
    - bun:sqlite works in compiled binary (validate R1)
    - Vitest runs with Bun runtime
    depends_on: []

A.2 [Implement] Core types + Zod schemas
    Estimate: M
    Approach: Define all types from SPEC-002 as TypeScript types + Zod validators
    Source: SPEC-002 §2, §3, §4
    owns_files: src/core/types.ts, src/core/schemas.ts, src/core/errors.ts
    AC:
    - All types from SPEC-002 exported: DocRecord, LinkRecord, VersionRecord, etc.
    - Zod schemas validate all type-specific extra fields (AdrExtra, TaskExtra, etc.)
    - LoreError discriminated union (12 error types from SPEC-001 §5)
    - Result<T, LoreError> utility type
    - DocStatus lifecycle transitions enforced by Zod refinement
    depends_on: [A.1]

A.2t [Test] Core types + Zod schemas — RED
    Estimate: S
    Source: AC of A.2
    test_scenarios:
    - Given valid spec input with parent_id, When validate, Then pass
    - Given spec input without parent_id, When validate, Then SCHEMA_VIOLATION
    - Given adr input without decision_status, When validate, Then SCHEMA_VIOLATION
    - Given status transition draft→approved, When validate, Then pass
    - Given status transition archived→approved, When validate, Then INVALID_TRANSITION
    - Given slug "spec-auth-v2", When validate regex, Then pass
    - Given slug "INVALID SLUG!", When validate, Then fail
    AC:
    - All scenarios written as Vitest tests
    - Run → all RED (missing implementation)
    depends_on: [A.1]

A.3 [Implement] StoreInterface + SQLiteStore
    Estimate: L
    Approach: Implement StoreInterface from SPEC-001 §4 using bun:sqlite. SQLite schema from SPEC-002 §7.
    Source: SPEC-001 §4, SPEC-002 §7
    owns_files: src/store/store-interface.ts, src/store/sqlite-store.ts, src/store/migrations/001-initial.sql
    AC:
    - StoreInterface fully implemented per SPEC-001 §4 signatures
    - SQLite schema matches SPEC-002 §7.1 (5 tables, all indexes, FTS5 triggers)
    - PRAGMA user_version migration system works
    - WAL mode enabled for concurrent reads
    - All CRUD operations: insert, find, findMany, update, softDelete
    - Link operations: addLink, removeLink, findLinks (with cycle detection for parent)
    - FTS5 search works with ranking
    - Version snapshot on every write
    - Audit log append
    depends_on: [A.2]

A.3t [Test] SQLiteStore — RED
    Estimate: M
    Source: AC of A.3
    test_scenarios:
    - Given empty DB, When insert doc, Then findable by id AND slug
    - Given doc v1, When update content, Then version incremented, old version in history
    - Given doc, When softDelete, Then deleted_at set, findMany excludes it
    - Given parent A→B, When set B as parent of A, Then LINK_CYCLE error
    - Given 3 docs, When FTS search "auth", Then ranked results with snippets
    - Given 100 docs, When findMany with type+status filter, Then correct subset returned
    - Given doc, When addLink(parent) and doc already has parent, Then error (tree constraint)
    - Given audit entry, When queryAudit by doc_id, Then entry found
    AC:
    - All scenarios as Vitest tests
    - Run → all RED
    depends_on: [A.2]

A.4 [Implement] InMemoryStore (test double)
    Estimate: S
    Approach: Implement StoreInterface with Map/Array for test isolation
    Source: SPEC-001 §6.2
    owns_files: src/store/in-memory-store.ts
    AC:
    - Implements same StoreInterface as SQLiteStore
    - All SQLiteStore tests pass when swapped to InMemoryStore (adapter independence proof)
    depends_on: [A.2]
```

### Phase B: Service Layer (parallel — all 5 services independent)

All Phase B tasks depend on A.3 (store ready). No cross-dependencies within Phase B.

```
B.1 [Implement] CorpusService
    Estimate: L
    Approach: Per SPEC-001 §3.1 interface. resolve() handles slug→ULID lookup.
    Source: SPEC-001 §3.1
    owns_files: src/service/corpus-service.ts
    AC:
    - All CorpusService methods implemented per SPEC-001 §3.1
    - resolve(input) handles ULID and slug lookup with fuzzy suggestions
    - create() auto-generates ULID + slug, validates type-specific fields via Zod
    - get() returns DocWithNavigation (parent, siblings, children, related)
    - set() increments version, creates snapshot, resets approved→draft
    - delete() requires confirm=true, soft-deletes with 30-day window
    - list() supports all filters (type, status, since, author, tag)
    - search() delegates to FTS5 via store
    - tree() builds recursive tree from parent links
    - link()/unlink() validates both IDs exist, enforces tree constraint for parent
    depends_on: [A.3, A.3t]

B.1t [Test] CorpusService — RED
    Estimate: M
    Source: AC of B.1
    test_scenarios:
    - Given empty corpus, When create(spec, title="Auth"), Then doc created with slug "spec-auth", version=1
    - Given doc "spec-auth", When get("spec-auth"), Then returns doc with navigation
    - Given doc "spec-auth" at v3, When set with stale version, Then STALE_VERSION error
    - Given approved doc, When set content, Then status resets to draft, version incremented
    - Given "spec-auth", When delete without confirm, Then DELETE_REQUIRES_CONFIRM
    - Given 10 docs of mixed types, When list(type="spec"), Then only specs returned
    - Given doc A parent of B, When tree(A), Then tree includes B as child
    - Given nonexistent slug, When resolve("spec-xyz"), Then DOC_NOT_FOUND with suggestions
    depends_on: [A.3, A.4]

B.2 [Implement] ReviewService
    Estimate: S
    Approach: Per SPEC-005 interface. Thin wrapper around CorpusService status transitions.
    Source: SPEC-001 §3.2, SPEC-005
    owns_files: src/service/review-service.ts
    AC:
    - pending() returns docs with status=draft, filterable by author/type/since
    - approve() transitions draft→approved, records reviewer in audit
    - reject() keeps draft, records reason in audit
    - Editing approved doc resets to draft (via CorpusService.set hook)
    depends_on: [A.3, A.3t]

B.2t [Test] ReviewService — RED
    Estimate: S
    Source: AC of B.2, SPEC-005 §6
    test_scenarios:
    - Given 3 docs (2 draft, 1 approved), When pending(), Then returns 2 draft docs
    - Given draft doc, When approve(), Then status=approved, audit entry with reviewer
    - Given draft doc, When reject(reason="incomplete"), Then status stays draft, reason in audit
    - Given archived doc, When approve(), Then INVALID_TRANSITION error
    depends_on: [A.3, A.4]

B.3 [Implement] VersionService
    Estimate: M
    Approach: Per SPEC-006 interface. Diff uses 'diff' npm package.
    Source: SPEC-001 §3.3, SPEC-006
    owns_files: src/service/version-service.ts
    AC:
    - log() returns version entries for a doc, newest first
    - diff() produces unified diff between any two versions (default: latest vs previous)
    - diff() includes frontmatter field changes and status changes
    - restore() creates NEW version (N+1) with content from specified version. Non-destructive
    depends_on: [A.3, A.3t]

B.3t [Test] VersionService — RED
    Estimate: S
    Source: AC of B.3, SPEC-006 §6
    test_scenarios:
    - Given doc created then edited twice, When log(), Then 3 versions (create, update, update)
    - Given doc at v3, When diff(v1, v3), Then shows content changes between v1 and v3
    - Given doc at v3, When restore(v1), Then new v4 created with v1's content, v1-v3 untouched
    - Given doc at v3, When diff() (no args), Then shows diff between v2 and v3
    depends_on: [A.3, A.4]

B.4 [Implement] OutlineService (MDX resolution)
    Estimate: M
    Approach: Per SPEC-004. remark-parse + remark-mdx for AST. Lazy-loaded to protect cold start.
    Source: SPEC-001 §3.4, SPEC-004
    owns_files: src/service/outline-service.ts, src/service/mdx/
    AC:
    - resolve() parses MDX AST, finds component nodes, resolves each against store
    - All 7 components (ChildrenOf, RecentDecisions, ActivePlans, ModuleTree, RelatedOf, Embed, HealthStats) implemented
    - Unknown components stripped with warning (security whitelist)
    - Props validated per SPEC-004 §3 table
    - Graceful degradation: missing doc in <Embed> renders "[not found]" not crash
    - Resolution < 50ms for 7 components on 500-doc corpus
    depends_on: [A.3, A.3t]

B.4t [Test] OutlineService — RED
    Estimate: S
    Source: AC of B.4, SPEC-004 §7
    test_scenarios:
    - Given PRD with <ChildrenOf role="spec" /> and 3 child specs, When resolve(), Then result contains 3 children
    - Given doc with <Embed id="NONEXISTENT" />, When resolve(), Then graceful "[not found]" not crash
    - Given doc with <ScriptInjection />, When resolve(), Then component stripped, warning emitted
    - Given doc with no MDX components, When resolve(), Then pass-through (no modification)
    - Given 500-doc corpus, When resolve PRD with all 7 components, Then < 50ms
    depends_on: [A.3, A.4]

B.5 [Implement] MigrationService
    Estimate: M
    Approach: Per SPEC-007. Parse v1 YAML frontmatter + markdown. Secret scan via regex.
    Source: SPEC-001 §3.5, SPEC-007
    owns_files: src/service/migration-service.ts
    AC:
    - analyze() scans v1 directory, parses all .md files, returns MigrationReport
    - analyze() detects secrets (API keys, AWS keys, private keys) via regex patterns from SPEC-007 §4
    - execute() imports docs with type mapping per SPEC-007 §2 table
    - Links resolved: v1 link array → v2 link records with type inference
    - Idempotent: re-running skips already-imported docs (by v1 original ID)
    - Unknown v1 types → knowledge with warning
    depends_on: [A.3, A.3t]

B.5t [Test] MigrationService — RED
    Estimate: S
    Source: AC of B.5, SPEC-007 §6
    test_scenarios:
    - Given v1 dir with 5 .md files, When analyze(), Then report shows 5 parseable, type mappings
    - Given v1 doc with "AKIA..." pattern, When analyze(), Then secret warning in report
    - Given v1 spec doc, When execute(), Then imported as type=spec with slug auto-generated
    - Given v1 doc with unknown type "custom-note", When execute(), Then imported as knowledge with warning
    - Given already-imported corpus, When execute() again, Then "5 docs skipped (already exist)"
    depends_on: [A.3, A.4]
```

### Phase C: CLI Adapter + Integration (serial)

```
C.1 [Implement] CLI framework + command dispatch
    Estimate: M
    Approach: citty for arg parsing. Thin adapter: parse → service call → format.
    Source: SPEC-003
    owns_files: src/adapters/cli/index.ts, src/adapters/cli/commands/
    AC:
    - All 22 commands from SPEC-003 §3 registered and dispatched
    - Each command: parse args → call service → format output
    - --json flag on every command (identical structure to future MCP response)
    - --verbose flag for detailed output
    - Exit codes per SPEC-003 §5 (0=success, 1=error, 2=usage, 3=not-found, 4=validation, 5=conflict)
    - Error messages include suggestions (e.g., "Did you mean spec-auth-v2?")
    depends_on: [B.1, B.2, B.3, B.4, B.5]

C.2 [Implement] Output formatting
    Estimate: S
    Approach: Terminal formatting: tables, trees, colored diff, navigation footer.
    Source: SPEC-003 §4
    owns_files: src/adapters/cli/formatters/
    AC:
    - Document display with header + content + navigation footer (SPEC-003 §4.1)
    - List display as aligned table (SPEC-003 §4.2)
    - Tree display with Unicode box-drawing characters (SPEC-003 §4.3)
    - Error display with suggestions (SPEC-003 §4.4)
    - Colored unified diff for `lore diff`
    depends_on: [C.1]

C.3 [Test] End-to-end CLI integration
    Estimate: M
    Approach: Spawn `lore` binary, test real CLI input → output against golden fixtures
    Source: SPEC-003 §7
    owns_files: tests/e2e/
    test_scenarios:
    - `lore init` → creates .lore/ directory with config.yaml and lore.db
    - `lore create spec --title "Auth"` → prompts for parent, creates doc, prints slug
    - `lore get spec-auth` → displays doc with navigation footer
    - `lore get spec-auth --json` → valid JSON with doc + navigation structure
    - `lore list --type spec` → table with only spec docs
    - `lore search "auth"` → FTS5 results with snippets
    - `lore tree` → renders tree from PRD root
    - `lore pending` → shows draft docs
    - `lore approve spec-auth` → status changes to approved
    - `lore log spec-auth` → version history
    - `lore diff spec-auth` → colored diff
    - `lore get NONEXISTENT` → exit code 3, error with suggestion
    AC:
    - All scenarios pass against compiled Bun binary
    - Tests run in isolated temp directory (no shared state)
    depends_on: [C.1, C.2]

C.4 [Implement] App composition root + lore init
    Estimate: S
    Approach: createApp() wiring from SPEC-001 §6. `lore init` creates .lore/ directory.
    Source: SPEC-001 §6, SPEC-003 §6
    owns_files: src/app.ts, src/adapters/cli/commands/init.ts
    AC:
    - createApp(config) wires all services with SQLiteStore
    - `lore init` creates .lore/ directory with config.yaml and empty SQLite DB
    - .lore/.gitignore auto-generated (ignores lore.db*)
    depends_on: [C.1]
```

### Phase D: Compile + Dogfood + Polish

```
D.1 [Implement] Bun compile + distribution
    Estimate: S
    Approach: `bun build --compile` with lazy dynamic imports for heavy modules
    Source: PRD-001 §6 M3
    owns_files: scripts/build.ts
    AC:
    - Single binary produced by `bun build --compile --target=bun-darwin-arm64`
    - Binary cold-start < 200ms (NFR-1)
    - All E2E tests pass against compiled binary (not just `bun run`)
    depends_on: [C.3]

D.2 [Implement] Dogfood — import Lore's own corpus
    Estimate: M
    Approach: Use `lore migrate v1` to import existing docs, then use Lore for all new docs
    Source: PRD-001 §6 M3 gate
    owns_files: N/A (operational task)
    AC:
    - Lore's PRD + 7 specs + ideation doc imported into Lore
    - `lore tree` renders the full document tree correctly
    - `lore get prd-lore` shows PRD with <ChildrenOf> resolving to 7 specs
    - `lore search "service layer"` finds SPEC-001
    - Team member (or simulated) can onboard by browsing the corpus
    depends_on: [D.1]

D.3 [Implement] Bug fixes from dogfood
    Estimate: M
    Approach: Fix issues discovered during D.2
    Source: D.2 findings
    owns_files: (various — bug-dependent)
    AC:
    - All issues found in D.2 resolved
    - E2E tests updated to cover discovered edge cases
    - No known P1-blocking bugs
    depends_on: [D.2]

D.4 Phase 1 review + retrospective
    Estimate: S
    Approach: Verify all P1 goals met, document learnings
    Source: PRD-001 §6 P1 gate
    AC:
    - PRD-001 §6 Phase 1 gate: "Lore manages its own corpus" verified
    - All specs' acceptance criteria verified against running system
    - Retrospective doc created: what worked, what didn't, P2 adjustments
    depends_on: [D.3]
```

## Critical Path

```
A.1 → A.2 → A.3 → B.1 → C.1 → C.2 → C.3 → D.1 → D.2 → D.3 → D.4
 M      M     L     L     M      S      M      S      M      M      S
```

**[CRITICAL_PATH]** duration: 13 session-units | path: A.1→A.2→A.3→B.1→C.1→C.2→C.3→D.1→D.2→D.3→D.4 | slack tasks: 8 (B.2-B.5 + tests)

## Estimation Summary

| Phase | Tasks | Session-units | Parallel savings |
|---|---|---|---|
| A: Foundation | 5 (incl. tests) | 5 (serial: M+M+L = 5) | — |
| B: Services | 10 (5 impl + 5 test) | 3 (parallel: longest = L+M = 3) | Saves ~7 units vs serial |
| C: CLI + Integration | 4 | 4 (serial: M+S+M+S = 4) | — |
| D: Compile + Dogfood | 4 | 4 (serial: S+M+M+S = 4) | — |
| **Total** | **23** | **16 serial / ~10 with parallelism** | |

**[ESTIMATION]** Total: 16 session-units serial | With Phase B parallelism: ~10 session-units | Critical path: 13 session-units

## Exit Criteria

- [ ] All 23 tasks completed
- [ ] All acceptance criteria verified
- [ ] `lore` compiled binary works on macOS
- [ ] Cold start < 200ms
- [ ] Lore manages its own development corpus (PRD + 7 specs)
- [ ] Risk register reviewed: all risks mitigated or accepted
- [ ] Phase 1 retrospective completed
