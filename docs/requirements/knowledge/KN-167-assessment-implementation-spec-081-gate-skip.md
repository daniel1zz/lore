---
id: KN-167
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-081 gate-skip observability + push-time chain check (2026-07-26)"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-075
links:
  - {id: PLAN-075, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01KYEK43VMSMWCHY42N4HD5TXM`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-080-1 | 86 | Named test file run twice (task agent + orchestrator attested), 15 tests pass. Statement's sub-claims (mechanism config_disabled, unwired port no-op, failing port non-blocking) are asserted only by test titles unseen here; no diff to confirm port wiring is app.ts-only. | task-t1-gateenforcer-skip-audit-port-lore-gate-env-bypass-trace (evidence [1],[3] gate-skip-audit.test.ts pass, 15 tests) |
| AC-080-2 | 86 | gate-bypass-audit.test.ts passes (14 tests), attested by orchestrator rerun. Cannot confirm from materials that the unreachable-store path prints the not-audited stderr line and exits 0, nor that the service layer stayed LORE_GATE_BYPASS-free (no diff). | task-t1-gateenforcer-skip-audit-port-lore-gate-env-bypass-trace (evidence [2],[4] pass, 14 tests) |
| AC-080-3 | 82 | pre-push-parity.test.ts passes (8 tests), orchestrator-attested. Byte-identity and the lore audit --verify invocation are only inferred from the suite name. T2's own note requires assets-manifest regeneration (SPEC-076); no build/--check evidence for that was recorded. | task-t2-pre-push-chain-check-both-hook-copies-parity-test (evidence [1],[3] pass, 8 tests) |
| AC-080-4 | 85 | audit-tamper.bun.test.ts passes under bun, attested. Visible output tail lists only pre-existing hash_mismatch cases and is truncated before any genesis-deletion/prev_link_mismatch case, so the new pin itself is not directly visible in the materials. | task-t2-pre-push-chain-check-both-hook-copies-parity-test (evidence [2],[4] pass; tail truncated) |
| AC-080-5 | 80 | Attested build oracle `bun run typecheck && bun run test` recorded pass by the orchestrator. Only a truncated tail of unrelated passing suites is shown — no terminal summary/exit-code line, and the full-regression run is a single unreplicated observation. | task-t1-gateenforcer-skip-audit-port-lore-gate-env-bypass-trace (evidence [5] build pass, recorder=main-orchestrator) |

## Gaps

- T2 explicitly requires regenerating packages/lore/src/generated/assets-manifest.ts (SPEC-076) after editing assets/project/pre-push, verified by bun run build or its --check mode. No evidence record contains a build/--check run for the manifest; AC-080-5's build oracle is typecheck+test only. A stale manifest would ship a pre-push asset that does not match the committed hook.
- The full-regression evidence shows only a truncated tail of unrelated passing suites (docs cookie auth, dashboard calibration) with no final summary or exit-code line. Pass status is taken from the recorder's assertion rather than from visible runner output.
- The audit-tamper output tail cuts off before any genesis-deletion / prev_link_mismatch case appears, so the specific new pin required by the AC is not observable in the materials — only the suite-level pass is.
- No knowledge docs captured despite the spec establishing durable conventions (gate_skipped mechanism vocabulary, best-effort fail-open audit port, pre-push dual-copy parity invariant) that future work will need to honour.

## Recommendations

- Add a manifest-freshness oracle to any task touching assets/project/*: record `bun run build --check` (or equivalent) as evidence and confirm packages/lore/src/generated/assets-manifest.ts was regenerated and committed.
- Require evidence output_tail capture to end on the runner's summary (Test Files / Tests / exit code) instead of a fixed byte truncation, especially for full-regression build oracles.
- Include the implementation diff in the audit bundle, or at minimum the changed hook files and the GateEnforcer port wiring site.
- Capture a short knowledge doc for the gate_skipped mechanism vocabulary and the pre-push dual-copy parity invariant.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 46866ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.72 | evidence | All 5 ACs have passing script oracles, each with an orchestrator-attested rerun, plus a full typecheck+test regression. Behavioural sub-claims rest on unseen test bodies. |
| evidence_integrity | 80 | 0.7 | evidence | Every AC independently re-run by the orchestrator; commands match AC verify strings exactly. Weakened by truncated tails, ratio 0.56, and suites authored by the implementers. |
| scope_fidelity | 82 | low | absence | Plan declares no ac_scope; all 5 declared ACs covered and task descriptions match the wave split. No diff, so drift outside the declared anchors cannot be checked. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-080-3 | T2 explicitly requires regenerating packages/lore/src/generated/assets-manifest.ts (SPEC-076) after editing assets/project/pre-push, verified by bun run build or its --check mode. No evidence record contains a build/--check run for the manifest; AC-080-5's build oracle is typecheck+test only. A stale manifest would ship a pre-push asset that does not match the committed hook. |
| evidence_integrity | minor | AC-080-5 | The full-regression evidence shows only a truncated tail of unrelated passing suites (docs cookie auth, dashboard calibration) with no final summary or exit-code line. Pass status is taken from the recorder's assertion rather than from visible runner output. |
| evidence_integrity | minor | AC-080-4 | The audit-tamper output tail cuts off before any genesis-deletion / prev_link_mismatch case appears, so the specific new pin required by the AC is not observable in the materials — only the suite-level pass is. |
| outcome | minor | — | No knowledge docs captured despite the spec establishing durable conventions (gate_skipped mechanism vocabulary, best-effort fail-open audit port, pre-push dual-copy parity invariant) that future work will need to honour. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a manifest-freshness oracle to any task touching assets/project/*: record `bun run build --check` (or equivalent) as evidence and confirm packages/lore/src/generated/assets-manifest.ts was regenerated and committed. | T2 names this prerequisite but no oracle run enforces it; a stale generated manifest silently breaks the asset/hook parity AC-080-3 guarantees. |
| process | Require evidence output_tail capture to end on the runner's summary (Test Files / Tests / exit code) instead of a fixed byte truncation, especially for full-regression build oracles. | AC-080-5 and AC-080-4 tails end mid-stream, leaving the recorded pass unverifiable from the bundle alone. |
| process | Include the implementation diff in the audit bundle, or at minimum the changed hook files and the GateEnforcer port wiring site. | Contract-shaped ACs (byte-identical, fail-open, never blocks the skip) cannot be judged from suite names and pass counts. |
| spec | Capture a short knowledge doc for the gate_skipped mechanism vocabulary and the pre-push dual-copy parity invariant. | Zero knowledge docs linked; these are cross-spec conventions later work must preserve. |

## Unverifiable Materials

- Implementation diff: diff_available=false; no source shown for GateEnforcer port, CLI bypass path, or either pre-push hook.
- Test file contents for all four suites: Only pass counts and partial tails provided; assertions behind AC sub-claims not inspectable.
- packages/lore/src/generated/assets-manifest.ts regeneration: No build or --check oracle recorded for the SPEC-076 freshness requirement named in T2.
- AC-080-5 terminal regression summary: output_tail truncated mid-suite; no aggregate result or exit code visible.

## Rubric Warnings

- Dimension "scope_fidelity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.56
