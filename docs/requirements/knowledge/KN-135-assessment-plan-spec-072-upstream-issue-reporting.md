---
id: KN-135
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-072 upstream issue reporting (report-issue) (2026-07-24)"
status: draft
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PLAN-045
links:
  - {id: PLAN-045, type: informs}
---
# Assessment: met (88/100)

Scope: plan `01KY95QVH7Z7RV532BRG0527TB`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-072-1 | 90 | Cross-corpus round-trip test passes with attested autopilot re-run; diff shows readyAdhoc carve-out excluding draft issue-reports until approved, matching the AC's pending-queue/absent-from-adhoc requirement. | task-skill-test-t6-cross-corpus-twin-fixture-green-e2e-suite-ac (attested pass ev[14]) |
| AC-072-2 | 90 | Unconfigured-upstream exit-4 + zero-writes verified; attested output tail confirms both config keys named and no receipt file. buildUnconfiguredUpstreamError emits both keys with YAML example. | task-skill-test-t6-cross-corpus-twin-fixture-green-e2e-suite-ac (attested ev[15]) |
| AC-072-3 | 88 | Root-PRD mismatch exit-4 naming expected-vs-found, upstream doc count unchanged; attested pass. matchRootPrd + openValidatedUpstream step-5 logic matches. | task-skill-test-t6-cross-corpus-twin-fixture-green-e2e-suite-ac (attested ev[16]) |
| AC-072-4 | 88 | Version skew exit-4 naming both versions; db/-wal sha256 identical, -shm size invariant confirmed in attested output. Readonly probe before store construction upholds no-mutation. | task-skill-test-t6-cross-corpus-twin-fixture-green-e2e-suite-ac (attested ev[23]) |
| AC-072-5 | 88 | Sync-enabled upstream rejected exit-4 naming SQLite-only constraint; attested pass. openValidatedUpstream step-3 checks sync.enabled before probe, matching no-store-construction intent. | task-skill-test-t6-cross-corpus-twin-fixture-green-e2e-suite-ac (attested ev[17]) |
| AC-072-6 | 90 | Rate-cap 11th report exit-4 listing 10 ids, count stays 10; attested pass with 23 expect calls. countOpenReports + OPEN_REPORT_CAP=10 wiring matches. | task-skill-test-t6-cross-corpus-twin-fixture-green-e2e-suite-ac (attested ev[18]) |
| AC-072-7 | 90 | Vitest DI test verifies createDraft failure propagated verbatim + zero receipt append; attested via T3 autopilot. Service returns createResult err verbatim before receipts.append. | task-skill-implement-t3-issuereportservice-receiptlog-green-vs (attested ev[5]) |
| AC-072-8 | 88 | Zero-doc upstream yields empty possible_duplicates + exit 0; attested pass. Advisory dedup returns empty and never blocks filing. | task-skill-test-t6-cross-corpus-twin-fixture-green-e2e-suite-ac (attested ev[19]) |
| AC-072-9 | 88 | 2 concurrent reports → 2 distinct tasks + exactly 2 parseable receipt lines; attested pass. append is appendFileSync-per-line supporting concurrency. | task-skill-test-t6-cross-corpus-twin-fixture-green-e2e-suite-ac (attested ev[20]) |
| AC-072-10 | 87 | --list joins live status + rejection reason; removed upstream degrades to unreachable exit 0; attested. getDocStatus + list() unreachable-degrade path matches. Rejection-reason via audit trail is nuanced but implemented. | task-skill-test-t6-cross-corpus-twin-fixture-green-e2e-suite-ac (attested ev[21]) |
| AC-072-11 | 89 | MCP without 'by' rejected; with 'by' produces same 7-field task shape as CLI; attested (2 tests). LoreReportIssueSchema requires by; shared wiring guarantees shape parity. | task-skill-test-t6-cross-corpus-twin-fixture-green-e2e-suite-ac (attested ev[22]) |
| AC-072-13 | 90 | Static import-graph pin passes under vitest (attested); service uses import type only from flows/*, keeping bun:sqlite out of vitest graph. Diff confirms type-only import. | task-skill-implement-t3-issuereportservice-receiptlog-green-vs (attested ev[6]) |
| AC-072-12 | 90 | Probe-purity bun test passes attested; db/-wal/-shm fingerprint unchanged on WAL db. probeUpstreamDb opens readonly, closes in finally, structurally cannot migrate. | task-skill-implement-t4-flows-upstream-probe-readonly-upstream (attested ev[4]) |

## Gaps

- T5 wiring (surface halves of AC-072-2/AC-072-11) has 0 autopilot-attested evidence; all attestation for those ACs comes from T6's e2e suite. Acceptable given T6 coverage but leaves the wiring layer's own oracles self-reported only.
- Global attested_evidence_ratio 0.32: majority of oracle runs recorded by implementing agents (agent:t*), not independent autopilot. Each AC does carry one autopilot pass, mitigating the risk.

## Recommendations

- Require every archived task to carry at least one autopilot-attested oracle run for the ACs it Covers, so wiring-only tasks (T5) do not fully delegate attestation to a downstream e2e task.
- For future features where one e2e suite is the sole oracle for a large AC cluster, add lightweight independent oracles for the P0 safety rails (version/sync/purity) as defense in depth.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 48611ms
- Retried: false
- Truncated sections: diff:packages/lore/src/store/schema-version.ts, diff:packages/lore/tests/unit/adapters/mcp-tools.test.ts, diff:packages/lore/tests/unit/core/issue-report.test.ts, diff:packages/lore/tests/unit/service/adhoc-task.test.ts, diff:packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts, diff:packages/lore/tests/unit/service/issue-report-service.test.ts, diff:packages/lore/tests/unit/service/receipt-log.test.ts, diff:packages/lore/tests/unit/store/schema-probe.bun.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.82 | evidence | All 13 declared ACs have passing script/vitest evidence with one attested re-run each; production diff coherently implements the §5 check sequence, R-5 rails, and readyAdhoc carve-out. |
| evidence_integrity | 78 | 0.75 | evidence | Every AC has ≥1 autopilot-attested pass with output tails, but ratio 0.32 and T5 has 0 attested; test files truncated so attestation trusted, not re-verified here. |
| scope_fidelity | 90 | 0.8 | evidence | 6 tasks map cleanly to Interface-First phases; no ac_scope drift, every declared AC covered; task-workflow carve-out is a scoped, documented cross-cutting edit tied to AC-072-1. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | minor | AC-072-11 | T5 wiring (surface halves of AC-072-2/AC-072-11) has 0 autopilot-attested evidence; all attestation for those ACs comes from T6's e2e suite. Acceptable given T6 coverage but leaves the wiring layer's own oracles self-reported only. |
| evidence_integrity | minor | — | Global attested_evidence_ratio 0.32: majority of oracle runs recorded by implementing agents (agent:t*), not independent autopilot. Each AC does carry one autopilot pass, mitigating the risk. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require every archived task to carry at least one autopilot-attested oracle run for the ACs it Covers, so wiring-only tasks (T5) do not fully delegate attestation to a downstream e2e task. | Reduces single-point-of-attestation risk when one suite backs many ACs. |
| plan | For future features where one e2e suite is the sole oracle for a large AC cluster, add lightweight independent oracles for the P0 safety rails (version/sync/purity) as defense in depth. | T6 backs 10/13 ACs; a single fixture regression could mask several. |

## Unverifiable Materials

- packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts and 6 other truncated test files: Omitted from diff per truncation manifest; test bodies not inspectable, so pass assertions are trusted from evidence tails rather than re-verified.
- packages/lore/src/store/schema-version.ts: Production file omitted from diff; LATEST_SCHEMA_VERSION value/bump-together invariant inferred from re-export and callers, not directly seen.

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 6 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.32
