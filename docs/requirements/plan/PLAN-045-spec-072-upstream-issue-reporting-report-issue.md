---
id: PLAN-045
type: plan
role: plan
title: "Plan — SPEC-072 upstream issue reporting (report-issue)"
status: archived
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: SPEC-072
phases:
  - {name: "Phase 1: Contracts", description: "Browser-safe core contracts: FeedbackConfigSchema, pure predicates, payload types; LATEST_SCHEMA_VERSION SSOT export"}
  - {name: "Phase 2: Implementations", description: "Parallel tracks: RED-first service (IssueReportService + ReceiptLog) and bun-only flows (upstream-probe + upstream-context UpstreamPort)"}
  - {name: "Phase 3: Wiring & E2E", description: "CLI report-issue + MCP lore_report_issue + registration; twin-corpus cross-corpus GREEN e2e suite"}
links:
  - {id: SPEC-072, type: implements}
---
# Plan — SPEC-072 upstream issue reporting (lore report-issue)

## Overview

Execute SPEC-072 (`spec-072-upstream-issue-reporting-lore-report-issue-consumer`, approved, 13 script-mode ACs) via Interface-First decomposition: contracts → parallel implementations (service ∥ flows) → wiring + cross-corpus e2e. Governance: **unattended** (autopilot). 6 tasks, 3 phases.

## Governance Mode

unattended — phase gates auto-proceed; Invariant violations hard-block regardless.

## Invariants

1. Every new service/flow public method returns `Promise<Result<T, LoreError>>` — no exception crosses a module boundary (repo service convention).
2. `report()` performs ZERO writes (upstream or local) before the step-8 `createDraft` succeeds; receipt append strictly after (SPEC-072 §check-sequence ordering).
3. No vitest-reachable module carries a value import of `bun:sqlite` or `flows/*` (AC-072-13 static pin) — `bun run test:vitest` must stay green without bun:sqlite externalization changes.
4. Tests NEVER touch the repo's own `.lore/` — cross-corpus tests use twin `mkdtemp` corpora (repo hard rule).
5. After every merge to main: `bun run typecheck` + scoped oracles green; full dual-runner suite once at plan close.
6. Upstream corpus schema is never mutated by any failure path (R-5b: probe is readonly; version-mismatch aborts before store construction).

## Risk Register

| ID | Impact | Risk | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | H | SQLiteStore ctor auto-migrates on open → filing a report could mutate a stranger's corpus schema | Any upstream open without version pre-check | T4 readonly probe + AC-072-12 purity oracle (mitigation task IN tree) | Revert wiring; gate report-issue behind explicit version-match check at CLI layer |
| R2 | M | bun:sqlite leaks into vitest import graph via service→flows import | vitest run fails resolving bun:sqlite | AC-072-13 static-import pin authored in T2 RED suite | Convert offending import to type-only; re-run |
| R3 | M | e2e spawns stale `dist/lore` → false green/red (four false-oracle vectors, standing lesson) | cross-corpus suite behavior contradicts source | T6 approach mandates `bun run build` before spawn; SPEC-061 verify-layer freshness precheck backstops | Rebuild + rerun; if verify inconclusive, treat as fail |
| R4 | L | FTS dedup empty-match ambiguity ("no match + ok" vs "errored") | possible_duplicates empty on seeded duplicate fixture | AC-072-8 boundary case + `dedup_degraded` flag distinguishes error from no-match | Surface degraded flag in CLI output |

## Critical Path

T1 → T2 → T3 → T5 → T6 = 9 session-units (S=1/M=2/L=3). Slack: T4 (parallel with T2+T3 wave).

## Estimation Summary

Total 12 session-units | Phase 1: 2 | Phase 2: 5 | Phase 3: 5 (T6 bumped M→L per audit). Critical path 10 units (T1 2 + T2 1 + T3 2 + T5 2 + T6 3) — parallelization already applied (T4 off-path); AI-executor sessions run far below human session-unit calibration.

## Exit Criteria

- All 6 tasks archived with passing oracle evidence referencing their Covers AC ids.
- `lore verify <plan>` attested pass on all 13 script ACs (AC-072-1..13).
- Full dual-runner suite + typecheck green on main (orchestrator, post-merge).
- `lore assess <plan>` run; findings fixed or accepted with rationale.
- Spec code anchors declared post-landing (`lore anchor add spec-072-… <path#Symbol>`); `lore status --check-drift` exit 0.

## Phase Descriptions

- **Phase 1: Contracts** — browser-safe core additions (FeedbackConfigSchema, pure predicates issue-report.ts, IssueReportPayload types) + `LATEST_SCHEMA_VERSION` SSOT export from sqlite-store.ts. Everything downstream imports these.
- **Phase 2: Implementations** — two parallel non-overlapping tracks: (a) RED-first service track: vitest scenarios then IssueReportService + ReceiptLog; (b) flows track: readonly upstream-probe + narrow upstream-context composition (UpstreamPort) + schema-probe purity bun test.
- **Phase 3: Wiring & E2E** — CLI `report-issue` command (strict-flag seam) + MCP `lore_report_issue` + lazy subcommand registration; then the twin-corpus cross-corpus GREEN e2e suite covering AC-072-1..6,8..11.

## Decisions Log

- 2026-07-24 Audit (lore-reviewer, NEEDS_WORK→fixed): T1 ACs rebound to per-scenario -t filters with matched counts; T6 bumped M→L with its 10/13-AC concentration consciously accepted (single e2e suite is deliberate: twin-fixture cost amortizes across ACs); estimation table recomputed.

- 2026-07-24 Strategy: **Interface-First** chosen over Vertical-Slice after ST comparison — R-5 safety rails are P0 (cannot land after happy path) and vertical slices share anchors (no real parallelism). Recorded under autopilot: user directive "继续，全自动执行" authorizes unattended ceremony (clarification dimensions already fixed by SPEC-072 design round: stack=repo conventions, data=extra passthrough per §18 P5, testing=twin-corpus bun + DI vitest, errors=R-5 fail-loud table, security=R-5 rails, no third-party additions → research gate satisfied by design-round codebase enumeration).
- TDD injection: service track gets a RED test task (T2 blocks T3); flows track folds its purity bun test into T4 (bun-only oracle, no parallel gain from splitting); e2e is Phase-3 GREEN acceptance (T6).
