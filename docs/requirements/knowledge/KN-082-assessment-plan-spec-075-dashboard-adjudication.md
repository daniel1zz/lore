---
id: KN-082
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-075 dashboard adjudication workbench + route telemetry (2026-07-24)"
status: approved
priority: medium
created: 2026-07-24
updated: 2026-07-26
tags: []
parent: PLAN-042
links:
  - {id: PLAN-042, type: informs}
---
# Assessment: partially_met (76/100)

Scope: plan `01KYA03WED749YYV5HFKK6JW4Q`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-075-1 | 91 | 4 pass / 0 fail (3 attested). TaskEvidencePanel renders evidence timeline with attested/self-reported labels + monospace output_tail; diff confirms component matches statement. | 01KYA04WP95TJYR3TCT275FJZ6 (vitest -t AC-075-1 pass) |
| AC-075-2 | 78 | 3 pass / 1 fail (2 attested). Sole fail is T1 pre-dependency (verification-projection-service.test.ts not yet created — 'No test files found'); passes once T2 lands the service. | 01KYA04W9RZRJ2P3B30EJ74YTX (lore+dashboard vitest pass) |
| AC-075-3 | 80 | 4 pass / 1 fail (2 attested). Boundary/empty states + D9 fail-loud VALIDATION_ERROR evidenced; lone fail is T1 file-absent ordering artifact, green thereafter. | 01KYA04W9RZRJ2P3B30EJ74YTX |
| AC-075-4 | 64 | 2 pass / 2 fail (2 attested fails). e2e passes only in T3 (final task); both fails are T1/T2 'No tests found' before the pw file existed. Same-screen + calibration parity green in final state, but weak attested-fail ratio. | 01KYA04WP95TJYR3TCT275FJZ6 (playwright pass, 3 tests) |
| AC-075-5 | 90 | 4 pass / 0 fail (3 attested). Keyboard-only j/k/a/x/e/o loop test; use-triage-keyboard hook in diff dispatches on KeyboardEvent with clamped selection. | 01KYA04WP95TJYR3TCT275FJZ6 |
| AC-075-6 | 90 | 4 pass / 0 fail (3 attested). Suppression via closest('input, textarea, [contenteditable=true], .cm-editor') confirmed in isEditableTarget; all five shortcuts gated. | 01KYA04WP95TJYR3TCT275FJZ6 |
| AC-075-7 | 90 | 4 pass / 0 fail (3 attested). JudgmentDrilldown renders reasons[]/blocking_questions/prompt_version; null judgment → no affordance; stale badge preserved via existing JudgmentBadge. | 01KYA04WP95TJYR3TCT275FJZ6 |
| AC-075-8 | 80 | 4 pass / 1 fail (2 attested). Telemetry one-JSONL-per-nav + disabled/failure branches evidenced; lone fail is T1 bun-test file-not-found ordering artifact. | 01KYA04W9RZRJ2P3B30EJ74YTX |
| AC-075-9 | 78 | 3 pass / 1 fail (2 attested). Auth matrix (401/200 cookie+bearer, 403 bearer+bad Origin) green; fail is T1 pre-existence of tests/http ('did not match'). | 01KYA04W9RZRJ2P3B30EJ74YTX |
| AC-075-10 | 91 | 4 pass / 0 fail (3 attested). grep oracle green; diff confirms projection-service imports derivations from @lore/core and dashboard has zero @lore/lore imports. | 01KYA047PRR04FZ0E22PDTS7A3 |
| AC-075-11 | 92 | 6 pass / 0 fail (3 attested). deriveAttestationSummary reproduces both conditions (per-task zero-attested AND ratio>=min); gate-predicates delegates, existing gate tests green + parity test. | 01KYA047PRR04FZ0E22PDTS7A3 |
| AC-075-12 | 52 | 1 pass / 3 fail (3 attested fails). Full oracle suite failed in T1/T2 (incomplete chain) and once in T3 [22] immediately before a passing re-run [23]. Final state green but repeated attested fails on the gating aggregate weaken confidence. | 01KYA04WP95TJYR3TCT275FJZ6 ([22] fail then [23] pass) |

## Gaps

- The full oracle suite (typecheck+vitest+bun+dashboard+playwright) recorded 3 attested fails vs 1 attested pass; in T3 a failing run [22] was immediately followed by a passing run [23] of the identical command, indicating the closing green state is not stably reproduced.
- Same-screen adjudication + field-by-field calibration parity is evidenced by a single passing playwright run in the final task, against 2 attested fails from earlier tasks; robustness of the e2e rests on one green invocation.

## Recommendations

- Require a final clean full-suite (AC-075-12) pass captured after all tasks complete, distinct from mid-chain oracle runs, so the gating aggregate is not scored against expected pre-dependency failures.
- Stabilize/quarantine the e2e port dependency (8787/5173) and re-run adjudication.pw.ts twice to confirm determinism before archiving.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 88382ms
- Retried: false
- Truncated sections: diff:packages/core/src/evidence-panel.test.ts, diff:packages/dashboard/CLAUDE.md, diff:packages/dashboard/tests/component/AdjudicationBar.test.tsx, diff:packages/dashboard/tests/component/DocDetail.test.tsx, diff:packages/dashboard/tests/component/EvidenceTab.test.tsx, diff:packages/dashboard/tests/component/JudgmentDrilldown.test.tsx, diff:packages/dashboard/tests/component/PlanAttestationPanel.test.tsx, diff:packages/dashboard/tests/component/SpecAcCoveragePanel.test.tsx, diff:packages/dashboard/tests/component/TaskEvidencePanel.test.tsx, diff:packages/dashboard/tests/e2e/adjudication.pw.ts, diff:packages/dashboard/tests/e2e/browse-ux.pw.ts, diff:packages/dashboard/tests/e2e/review-loop.pw.ts, diff:packages/dashboard/tests/unit/lib/api.test.ts, diff:packages/dashboard/tests/unit/lib/mutations.test.ts, diff:packages/dashboard/tests/unit/lib/use-route-telemetry.test.ts, diff:packages/dashboard/tests/unit/lib/use-triage-keyboard.test.ts, diff:packages/lore/src/adapters/http/dashboard-routes.ts, diff:packages/lore/src/adapters/http/routes.ts, diff:packages/lore/src/app.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/gate-predicates.ts, diff:packages/lore/src/service/verification-projection-service.ts, diff:packages/lore/tests/http/evidence-panel.bun.test.ts, diff:packages/lore/tests/http/telemetry-route.bun.test.ts, diff:packages/lore/tests/unit/service/gate-predicates.test.ts, diff:packages/lore/tests/unit/service/verification-projection-service.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.72 | evidence | 10 of 12 ACs strongly green in final state; UI/telemetry/gate-parity delivered. Only AC-075-12 aggregate and AC-075-4 e2e carry residual attested fails. |
| evidence_integrity | 70 | 0.66 | evidence | Independent autopilot re-runs corroborate agent claims; attested ratio 0.64. But AC-075-12 fail→pass flip and mid-chain fails leave the closing aggregate not cleanly attested. |
| scope_fidelity | 86 | 0.75 | evidence | Import-graph pins hold (AC-075-10 green), gate behavior byte-identical (AC-075-11), no ac_scope drift; changes confined to declared modules. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-075-12 | The full oracle suite (typecheck+vitest+bun+dashboard+playwright) recorded 3 attested fails vs 1 attested pass; in T3 a failing run [22] was immediately followed by a passing run [23] of the identical command, indicating the closing green state is not stably reproduced. |
| outcome | minor | AC-075-4 | Same-screen adjudication + field-by-field calibration parity is evidenced by a single passing playwright run in the final task, against 2 attested fails from earlier tasks; robustness of the e2e rests on one green invocation. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require a final clean full-suite (AC-075-12) pass captured after all tasks complete, distinct from mid-chain oracle runs, so the gating aggregate is not scored against expected pre-dependency failures. | Serialized plan re-runs all ACs per task, so early fails are inevitable but pollute the aggregate AC's evidence. |
| plan | Stabilize/quarantine the e2e port dependency (8787/5173) and re-run adjudication.pw.ts twice to confirm determinism before archiving. | AC-075-4 and AC-075-12 both show e2e as the flip point between fail and pass. |

## Unverifiable Materials

- packages/lore/src/service/verification-projection-service.ts (assembly of union via core SSOT fns, D9 fail-loud): Omitted from diff per truncation manifest; only oracle records and grep result observed, not source.
- packages/dashboard/tests/e2e/adjudication.pw.ts and omitted *.bun.test.ts / component tests: Test bodies omitted; scoring relies on pass/fail oracle records, not on inspecting assertion strength.

## Facts Summary

- AC coverage: 12 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.64
