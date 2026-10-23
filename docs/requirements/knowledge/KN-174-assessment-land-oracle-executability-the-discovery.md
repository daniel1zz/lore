---
id: KN-174
type: knowledge
role: knowledge
title: "Assessment: Land oracle executability: the discovery-refusal primitive, both call sites, and the audited escape for not-yet-written tests (2026-08-10)"
status: archived
priority: medium
created: 2026-08-10
updated: 2026-10-23
tags: []
parent: PLAN-079
links:
  - {id: PLAN-079, type: informs}
---
# Assessment: partially_met (70/100)

Scope: plan `01KZN4F66XA0S1E7N61EZ3M3S8`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-OX-1 | 92 | findDiscoveryRefusal visible in diff with all three captured patterns and null-on-genuine-failure by construction. Evidence: recorded expected-fail red, then attested pass (9 tests). Exit-code exactness only assertable in omitted test file. | task-add-finddiscoveryrefusal-to-lore-core-with-a-live-runner (evidence [1] red, [3]/[8] green attested) |
| AC-OX-2 | 90 | Consumer visible in verify-runner-service.ts ③.3: test-oracle + !executedSuccessfully + !timedOut → inconclusive + warning. Mandatory red was recorded as expected-fail by the running task, then attested pass. | task-consume-finddiscoveryrefusal-on-the-attested-exit-nonzero (evidence [1] expected-fail, [2]/[6] pass) |
| AC-OX-3 | 86 | Narrowing (not removal) is structurally evident: the fail path is untouched unless findDiscoveryRefusal matches. Attested pass recorded. No red recorded for the broadened-predicate mutation the AC names, so the RED clause is unmeasured. | task-consume-finddiscoveryrefusal-on-the-attested-exit-nonzero (evidence [3]/[7]) |
| AC-OX-4 | 84 | Red-then-green with attestation across both ac-service and ac-set suites; oracle-file-existence.ts documents the five token-less blind-spot commands explicitly. The load-bearing 'five accepted unchanged' half lives in omitted test files, so it is claimed, not seen. | task-promote-the-oracle-file-existence-primitives-into-lore (evidence [1] expected-fail, [3]/[5] pass) |
| AC-OX-5 | 88 | Live-spawn .bun.test.ts oracle went from module-resolution red to 6–7 pass, attested; tails name 'all three runner binaries actually launched' and 'exit EXACTLY 1'. Test body omitted, so 'never a hand-copied fixture' rests on tail names. | task-add-finddiscoveryrefusal-to-lore-core-with-a-live-runner (evidence [2] red, [4][5][7][9] pass) |
| AC-OX-6 | 10 | Zero evidence records (0 pass, 0 fail). No lore status --json run showing pass_unfalsified_count 0 or corpus fail count 0. The corpus-cleanup phase the plan gates behind the mechanism phase appears not to have executed. | — |
| AC-OX-7 | 10 | Zero evidence records. No ac-falsifiability population-union test run appears in any task, and no such test file is listed even among omitted files. The computed-union claim is entirely unmeasured. | — |
| AC-OX-8 | 72 | Test is visible in the diff and attested pass. But it asserts only two hand-built facts resolving to 'fail'; the AC's corpus-wide clause (58 fail_superseded + 590 attested_pass not reclassified) is asserted nowhere I can see, and no RED mutation was recorded. | task-consume-finddiscoveryrefusal-on-the-attested-exit-nonzero (evidence [4]/[8]; test body in acceptance.test.ts diff) |
| AC-OX-9 | 86 | Red recorded showing countUnredeemedAllowMissingPath absent, then attested pass; CLAUDE.md service table documents recompute-from-live-fs-every-call. Re-baselined scope matches the oracle. Implementation file (ac-service.ts) omitted, so recompute semantics are unseen. | task-promote-the-oracle-file-existence-primitives-into-lore (evidence [2] expected-fail, [4]/[6] pass) |
| AC-OX-10 | 84 | Expected-fail red then attested pass; tail names the single test covering refuse / accept-with-reason / refuse-empty-reason / status --json count. CLI and status command files are omitted, so 'drives the CLI, not AcService' is unverifiable from materials shown. | task-wire-allow-missing-path-and-the-unredeemed-declaration (evidence [1] expected-fail, [6] attested pass 1010ms) |

## Gaps

- No evidence exists for AC-OX-6. Its oracle (lore status --json, pass_unfalsified_count 0 and corpus fail count 0) was never run, and no SPEC-061/062/064 AC edits appear in the diff — the plan's corpus-cleanup phase looks unexecuted.
- No evidence exists for AC-OX-7. packages/core/tests/unit/ac-falsifiability.test.ts is neither in the diff nor in the truncation manifest, so the computed-union population claim has no oracle at all.
- The visible acceptance.test.ts additions assert only two hand-built facts. The AC's stronger corpus-wide clause (58 fail_superseded + 590 attested_pass unreclassified) is not measured by the oracle that attests it, so a green run overstates what was checked.
- The wiring task declared three deliverables; only CLI ac.ts and status.ts landed. The MCP surface is documented as having no AC-declaring tool, so the repo's stated CLI/MCP gate-parity invariant does not hold for D8 — accepted and disclosed, but still an open asymmetry.

## Recommendations

- Either execute the corpus-cleanup phase and record AC-OX-6's JSON-read counts, or split AC-OX-6/AC-OX-7 into a successor plan so this slice is not closed with two unmeasured criteria.
- Re-baseline AC-OX-8 to what its oracle measures (synthetic-fact precedence) or extend the test to read real corpus coverage counts.
- Require the named RED mutation to be recorded for every AC whose statement contains an explicit RED clause, including regression ACs like AC-OX-3 and AC-OX-8.
- Open a follow-up to design an MCP AC-declaring write path, or record a decision that AC declaration is CLI-only, so the gate-parity invariant is not left silently violated.

## Judgment

- Provider: claude-cli
- Prompt version: 7
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 70143ms
- Retried: false
- Truncated sections: diff:packages/core/tests/attestation-completeness.test.ts, diff:packages/lore/tests/e2e/discovery-refusal-live-capture.bun.test.ts, diff:packages/lore/tests/e2e/discovery-refusal-live-capture.bun.test.ts, diff:packages/lore/tests/unit/service/verify-completeness.test.ts, diff:packages/lore/src/service/ac-service.ts, diff:packages/lore/tests/unit/service/ac-service.test.ts, diff:packages/lore/tests/unit/service/ac-set.test.ts, diff:CLAUDE.md, diff:packages/lore/src/adapters/cli/commands/ac.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/tests/unit/adapters/ac-allow-missing-path-cli.test.ts, diff:packages/lore/tests/unit/adapters/cli-ac-set.test.ts, diff:packages/lore/tests/unit/cli/approve-advisory-render.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.75 | evidence | Mechanism (M6.1-M6.3) plus CLI wiring landed and are attested across 8 of 10 ACs; AC-OX-6 and AC-OX-7 have no runs at all, and the corpus-cleanup phase appears unstarted. |
| evidence_integrity | 78 | 0.7 | evidence | Reds recorded at the moment they were red for OX-1/2/4/5/9/10; each covered AC has one attested pass. Weakened by a 0.24 attested ratio and two ACs with no oracle run whatsoever. |
| scope_fidelity | 86 | 0.75 | evidence | Diff matches declared anchors; the falsified header sentence was corrected in-diff as required, and the MCP gap was measured and documented rather than silently skipped. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-OX-6 | No evidence exists for AC-OX-6. Its oracle (lore status --json, pass_unfalsified_count 0 and corpus fail count 0) was never run, and no SPEC-061/062/064 AC edits appear in the diff — the plan's corpus-cleanup phase looks unexecuted. |
| outcome | major | AC-OX-7 | No evidence exists for AC-OX-7. packages/core/tests/unit/ac-falsifiability.test.ts is neither in the diff nor in the truncation manifest, so the computed-union population claim has no oracle at all. |
| evidence_integrity | minor | AC-OX-8 | The visible acceptance.test.ts additions assert only two hand-built facts. The AC's stronger corpus-wide clause (58 fail_superseded + 590 attested_pass unreclassified) is not measured by the oracle that attests it, so a green run overstates what was checked. |
| scope_fidelity | minor | AC-OX-10 | The wiring task declared three deliverables; only CLI ac.ts and status.ts landed. The MCP surface is documented as having no AC-declaring tool, so the repo's stated CLI/MCP gate-parity invariant does not hold for D8 — accepted and disclosed, but still an open asymmetry. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Either execute the corpus-cleanup phase and record AC-OX-6's JSON-read counts, or split AC-OX-6/AC-OX-7 into a successor plan so this slice is not closed with two unmeasured criteria. | Two of ten ACs have zero oracle runs; closing now would let the slice read as fully verified. |
| spec | Re-baseline AC-OX-8 to what its oracle measures (synthetic-fact precedence) or extend the test to read real corpus coverage counts. | Same claim-wider-than-oracle shape that already forced AC-OX-9's re-baseline. |
| process | Require the named RED mutation to be recorded for every AC whose statement contains an explicit RED clause, including regression ACs like AC-OX-3 and AC-OX-8. | A green-only run does not demonstrate the mutation the AC claims would red it. |
| spec | Open a follow-up to design an MCP AC-declaring write path, or record a decision that AC declaration is CLI-only, so the gate-parity invariant is not left silently violated. | tools.ts now documents a pre-existing surface gap with no owning item. |

## Unverifiable Materials

- packages/lore/src/service/ac-service.ts: Omitted from diff; allowMissingPath refusal, reason-required check, and live-fs recompute for countUnredeemedAllowMissingPath could not be inspected.
- packages/lore/src/adapters/cli/commands/ac.ts and commands/status.ts: Omitted from diff; the live CLI flag and the status --json field AC-OX-10 requires are attested by a test tail only.
- packages/lore/tests/unit/adapters/ac-allow-missing-path-cli.test.ts: Omitted; cannot confirm the oracle drives the CLI handler rather than AcService, which is the exact false-green AC-OX-10 exists to prevent.
- packages/lore/tests/e2e/discovery-refusal-live-capture.bun.test.ts: Omitted; live-spawn and exact-exit-code assertions inferred from pass-line names in the evidence tail.
- AC-OX-6 status --json output and AC-OX-7 population-union test: No evidence records and no corresponding files in diff or truncation manifest.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.24
