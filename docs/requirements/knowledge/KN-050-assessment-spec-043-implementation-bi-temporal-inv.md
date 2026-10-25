---
id: KN-050
type: knowledge
role: knowledge
title: "Assessment: SPEC-043 Implementation — bi-temporal invalidation (2026-07-11)"
status: archived
priority: medium
created: 2026-07-11
updated: 2026-10-23
tags: []
parent: PLAN-027
links:
  - {id: PLAN-027, type: informs}
---
# Assessment: partially_met (85/100)

Scope: plan `01KX7XD8PV51PHNKCAQYC03QXF`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-MH-1 | 92 | validity.test.ts 29 pass, attested post-merge. Diff shows pure validity.ts: schema superRefine enforces invalid_at>=valid_at (equality legal), no future check (service-owned), isInvalidated flips at nowIso, effectiveValidAt falls back to created_at. | 01KX7XDMR4J3SJFD8W1GRC2RBB (evidence[1]) |
| AC-MH-2 | 90 | validity-service.test.ts 18 pass, attested. Service file unseen (truncated) but suite covers happy path, future-reject, DOC_NOT_FOUND, ULID resolution. | 01KX7XDMR4J3SJFD8W1GRC2RBB (evidence[2]) |
| AC-MH-3 | 90 | validity-service.test.ts 18 pass, attested. ADR pinned ordering + idempotent link repair covered by suite; service impl truncated but test-backed. | 01KX7XDMR4J3SJFD8W1GRC2RBB |
| AC-MH-4 | 90 | validity-service.test.ts 18 pass. decision_status_unchanged surfaced in CLI invalidate.ts and MCP tools.ts diffs; undo-on-never-invalidated VALIDATION_ERROR test-backed. | 01KX7XDMR4J3SJFD8W1GRC2RBB |
| AC-MH-5 | 90 | validity-filtering.test.ts 8 pass, attested. Order-preserving include_invalid, now-seam covered; store filter impls truncated but suite passes. | 01KX7XDMR4J3SJFD8W1GRC2RBB (evidence[5]) |
| AC-MH-6 | 90 | outline-validity.test.ts 12 pass, attested. Filter-before-slice, Embed degrade, includeInvalid banner, regression checks covered. | 01KX7XDMR4J3SJFD8W1GRC2RBB (evidence[6]) |
| AC-MH-7 | 91 | validity-projection.test.ts 9 pass, attested. Diff shows get.ts delegates to renderDocMarkdown (single banner impl), --raw skips banner; renderValidityBanner pure format with no dangling separator. | 01KX7XDMR4J3SJFD8W1GRC2RBB (evidence[7]) |
| AC-MH-8 | 88 | cli-invalidate.bun.test.ts 5 pass (spawned, assertFreshBinary), attested. invalidate command + badges + create --supersedes wired in diff. | 01KX7XDMR4J3SJFD8W1GRC2RBB (evidence[8]) |
| AC-MH-9 | 91 | mcp-invalidate.test.ts 5 pass; mcp-tools count 28→29 attested post-merge. lore_invalidate, validity_state, include_invalid, supersedes visible in tools.ts diff. | 01KX7XDMR4J3SJFD8W1GRC2RBB (evidence[9,13]) |
| AC-MH-10 | 89 | validity-service.test.ts 18 pass. D10 set-guard + first-signal-wins + S1 ADR message-forwarding fix visible in schemas.ts diff (issue-forwarding loop). | 01KX7XDMR4J3SJFD8W1GRC2RBB |
| AC-MH-11 | 45 | Human AC, 0 pass/0 fail — owner-executed throwaway-corpus script not yet recorded (D12, plan stays active). Cannot verify; underlying surfaces are script-attested, so partial credit. | — |
| AC-MH-12 | 90 | validity-feed-and-judge.test.ts 9 pass, attested. feed-flow renderDocMarkdown banner splice + review-template Staleness Notice + status warning all in diff, wired via shared helpers. | 01KX7XDMR4J3SJFD8W1GRC2RBB (evidence[11]) |
| AC-MH-13 | 90 | validity-supersede-orchestration.test.ts 6 pass, attested. create.ts/tools.ts use shared createWithSupersedes; loud orphan repair-command line present in both surfaces. | 01KX7XDMR4J3SJFD8W1GRC2RBB (evidence[12]) |

## Gaps

- Human owner-executed throwaway-corpus smoke test remains unrecorded (0 pass/0 fail); plan stays active by design (D12) until owner records it. Underlying surfaces are script-attested so functional risk is low.
- Core service/store implementations (validity-service.ts, corpus-service.ts, stores, outline-service.ts) truncated from diff for budget; verified only through passing suites, not direct inspection. Truncation manifest disclosed, so treated as present-unseen.

## Recommendations

- Owner runs and records AC-MH-11 to finalize plan closure.
- Capture a linked knowledge/ADR doc for the bi-temporal invalidation design decisions (D1-D11).

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 42983ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:packages/core/tests/validity.test.ts, diff:packages/lore/src/flows/supersede-flow.ts, diff:packages/lore/src/service/audit-service.ts, diff:packages/lore/src/service/checkpoint-registry.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/export-docs-service.ts, diff:packages/lore/src/service/outline-service.ts, diff:packages/lore/src/service/session-service.ts, diff:packages/lore/src/service/validity-service.ts, diff:packages/lore/src/store/in-memory-store.ts, diff:packages/lore/src/store/sqlite-store.ts, diff:packages/lore/src/store/store-shared.ts, diff:packages/lore/src/store/turso-store.ts, diff:packages/lore/tests/unit/adapters/cli-invalidate.bun.test.ts, diff:packages/lore/tests/unit/adapters/mcp-invalidate.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools.test.ts, diff:packages/lore/tests/unit/adapters/validity-projection.test.ts, diff:packages/lore/tests/unit/adapters/validity-supersede-orchestration.test.ts, diff:packages/lore/tests/unit/service/outline-validity.test.ts, diff:packages/lore/tests/unit/service/validity-feed-and-judge.test.ts, diff:packages/lore/tests/unit/service/validity-filtering.test.ts, diff:packages/lore/tests/unit/service/validity-service.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.85 | evidence | 12/12 script ACs attested pass post-merge (tsc 0, vitest 3400, bun 793); diff coheres with statements. Only human AC-MH-11 outstanding. |
| evidence_integrity | 90 | 0.85 | evidence | 0.86 attested ratio; post-merge full-suite runs by both task agents; per-suite reruns recorded; no self-report-only script ACs. |
| scope_fidelity | 88 | 0.8 | evidence | Disclosed deviations (export-docs import, ai-provider now-arg, flows/ files) all plan-sanctioned; no ac_scope; changes map to T1/T2 surfaces. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-MH-11 | Human owner-executed throwaway-corpus smoke test remains unrecorded (0 pass/0 fail); plan stays active by design (D12) until owner records it. Underlying surfaces are script-attested so functional risk is low. |
| evidence_integrity | minor | — | Core service/store implementations (validity-service.ts, corpus-service.ts, stores, outline-service.ts) truncated from diff for budget; verified only through passing suites, not direct inspection. Truncation manifest disclosed, so treated as present-unseen. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Owner runs and records AC-MH-11 to finalize plan closure. | Only remaining unresolved AC; plan design keeps it active until recorded. |
| plan | Capture a linked knowledge/ADR doc for the bi-temporal invalidation design decisions (D1-D11). | No knowledge docs captured; design rationale lives only in code comments. |

## Unverifiable Materials

- AC-MH-11 human smoke-test result: 0 pass/0 fail — owner has not recorded it yet (D12).
- Truncated production files (validity-service.ts, corpus-service.ts, stores, outline-service.ts): Omitted from diff for budget; only inferable via passing suites.

## Facts Summary

- AC coverage: 13 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.86
