---
id: KN-670
type: knowledge
role: knowledge
title: "Assessment: Evidence labels and reds are honest (2026-10-12)"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PLAN-153
links:
  - {id: PLAN-153, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01M4QDM1JQGQ3GC7N1SZ9X861W`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-EH-1 | 88 | Green-control row now writes RUNNER_UNATTESTED_CAPTURE_SOURCE, and all four pinned assertions were re-baselined. The attested pass on main prints the PASS line. One intermediate attested fail on the implement task was later superseded by passes. | task-verify-evidence-labels-and-red-proof-on-main (evidence [1]), task-skill-implement-runner-unattested-capture-label-for-the ([10] fail, [13] pass) |
| AC-EH-2 | 80 | Schema, CAPTURE_SOURCES, the shared resolveWrittenCaptureSource in both writers, the status three-bucket count and enumerator, and assess-render are all in the diff, and the attested pass is on main. The verify.ts:559 render and the (f) attested-pass done-floor path do not appear in the diff. | task-verify-evidence-labels-and-red-proof-on-main (evidence [2]) |
| AC-EH-3 | 90 | falsifierRangeRefusal sits in applyAcChange and compares only changed or added falsifiers on every path. The schema is untouched. 9 tests pass, attested on main. | task-verify-evidence-labels-and-red-proof-on-main (evidence [3]) |
| AC-EH-4 | 86 | The compiled e2e passes with attestation and the CLI help text is updated. The displayed tail shows only build output, so the PASS line relies on the attested exit code. | task-verify-evidence-labels-and-red-proof-on-main (evidence [4]) |
| AC-EH-5 | 91 | The range guard runs before target resolution and the green control, and its message names lore ac set and --falsifier-exit-code. 6 tests pass, service and CLI, attested on main. | task-verify-evidence-labels-and-red-proof-on-main (evidence [5]) |
| AC-EH-6 | 87 | The detector moved to core/command-pipe.ts and evidence-precheck only re-exports it. pipeRefusal applies to every oracle except other, on non-wholesale paths. 15 tests pass and the structural grep passes. advisories computed in admitAcWrite look unused; ac-service recomputes them. | task-verify-evidence-labels-and-red-proof-on-main (evidence [6]) |
| AC-EH-7 | 86 | The compiled e2e passes with attestation and the CLI prints advisories through the onAdvisory callback. Advisories are not surfaced on the create path, which is outside this AC. | task-verify-evidence-labels-and-red-proof-on-main (evidence [7]) |
| AC-EH-8 | 84 | parseFailedCaseCount and findCapturedRedProofGap are implemented: 126/127 is refused for any oracle, and test/e2e need a failed count in the stored tail. 20 or more tests pass, attested. The AC statement text is truncated in the materials. | task-verify-evidence-labels-and-red-proof-on-main (evidence [8]) |
| AC-EH-9 | 87 | The same guard is wired into commands/evidence.ts and mcp/tools.ts, right after the discovery refusal. The CLI subprocess and MCP tests pass, attested on main. | task-verify-evidence-labels-and-red-proof-on-main (evidence [9]) |
| AC-EH-10 | 82 | The falsify path checks discovery refusal and 126/127 before `matched` and records inconclusive/runner-unattested. 6 tests pass, including the genuine-red control. The discovery check covers only oracle test, not e2e. | task-verify-evidence-labels-and-red-proof-on-main (evidence [10]) |
| AC-EH-11 | 92 | `bun run typecheck` has attested passes on main and on every implement task. | task-verify-evidence-labels-and-red-proof-on-main (evidence [11]) |

## Gaps

- The verification task requires full test:vitest and test:bun runs on main (I8), but none are recorded; only per-AC scoped commands ran.
- Expected-fail rows on the implement tasks were run from scratchpad prefix-* directories, which suggests the reds were reproduced after the fact. The RED tasks' own expected-fail rows show no output tail.
- The falsify-path discovery refusal is gated on oracle === "test" in packages/lore/src/service/verify-runner-service.ts, so an e2e mutated run that finds no tests can still record expected-fail.
- admitAcWrite computes advisories in packages/lore/src/service/ac-write-chokepoint.ts, but packages/lore/src/service/ac-service.ts recomputes them with pipeAdvisories after the write. The admission field looks unused.
- The plan asked for a distinct third label in packages/lore/src/adapters/cli/commands/verify.ts rendering, but no change to that file appears in the diff.
- The captured-red proof also covers --result fail, on a corpus-author decision flagged as needing the user's confirmation. No confirmation is recorded.

## Recommendations

- Make the verification task record attested evidence for every non-AC deliverable it lists: full suites, the I4 pipe check, and the baseline prose grep.
- RED tasks should store a visible output tail on their expected-fail rows. Implement tasks should not carry red rows reproduced from a scratchpad prefix.
- Settle whether falsify-path discovery refusal applies to e2e and record the decision.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 57155ms
- Retried: false
- Truncated sections: spec, diff:packages/lore/tests/unit/adapters/capture-source-visibility.test.ts, diff:packages/lore/tests/unit/service/capture-source-required.test.ts, diff:packages/lore/tests/integration/cli/evidence-captured-red-proof-cli.test.ts, diff:packages/lore/tests/unit/adapters/captured-red-proof.test.ts, diff:packages/lore/tests/unit/adapters/evidence-capture-attestation.test.ts, diff:packages/lore/tests/unit/adapters/evidence-capture-window.test.ts, diff:packages/lore/tests/unit/adapters/mcp-evidence-capture.test.ts, diff:packages/lore/tests/e2e/ac-command-pipe-compiled.bun.test.ts, diff:packages/lore/tests/unit/service/ac-command-pipe-refusal.test.ts, diff:packages/lore/tests/unit/service/ac-set.test.ts, diff:packages/lore/tests/e2e/ac-falsifier-range-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli/verify-falsify-stored-exit-range-cli.test.ts, diff:packages/lore/tests/unit/service/falsifier-exit-code-range.test.ts, diff:packages/lore/tests/unit/service/falsify-stored-exit-range.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All five units are implemented in the diff and all 11 ACs have attested passes on main. Minor gaps: e2e discovery check on the falsify path and the verify.ts render. |
| evidence_integrity | 70 | 0.6 | evidence | AC runs are attested. Full-suite runs and verification-task deliverables are unevidenced, and reds were reproduced from scratchpad prefixes onto the implement tasks. |
| scope_fidelity | 85 | 0.65 | evidence | Changes match the plan units. Small extras: a public-path self-label guard and unsafePipeSegment. The --result fail extension is unconfirmed by the user. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The verification task requires full test:vitest and test:bun runs on main (I8), but none are recorded; only per-AC scoped commands ran. |
| evidence_integrity | minor | — | Expected-fail rows on the implement tasks were run from scratchpad prefix-* directories, which suggests the reds were reproduced after the fact. The RED tasks' own expected-fail rows show no output tail. |
| outcome | minor | AC-EH-10 | The falsify-path discovery refusal is gated on oracle === "test" in packages/lore/src/service/verify-runner-service.ts, so an e2e mutated run that finds no tests can still record expected-fail. |
| outcome | minor | AC-EH-6 | admitAcWrite computes advisories in packages/lore/src/service/ac-write-chokepoint.ts, but packages/lore/src/service/ac-service.ts recomputes them with pipeAdvisories after the write. The admission field looks unused. |
| outcome | minor | AC-EH-2 | The plan asked for a distinct third label in packages/lore/src/adapters/cli/commands/verify.ts rendering, but no change to that file appears in the diff. |
| scope_fidelity | minor | AC-EH-8 | The captured-red proof also covers --result fail, on a corpus-author decision flagged as needing the user's confirmation. No confirmation is recorded. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Make the verification task record attested evidence for every non-AC deliverable it lists: full suites, the I4 pipe check, and the baseline prose grep. | Those invariants are currently asserted but not evidenced. |
| skill | RED tasks should store a visible output tail on their expected-fail rows. Implement tasks should not carry red rows reproduced from a scratchpad prefix. | This keeps the red-first trail trustworthy and avoids reds transcribed after the fact. |
| plan | Settle whether falsify-path discovery refusal applies to e2e and record the decision. | The current gate leaves an e2e loophole. |

## Unverifiable Materials

- 14 omitted test files (e.g. capture-source-required.test.ts, captured-red-proof.test.ts): Contents not shown; test sub-case coverage is inferred from pass counts only.
- AC-EH-8..11 full statements: The spec AC table is truncated mid AC-EH-8.
- checkDoneFloors handling of runner-unattested pass: Plan A's extraction and the done-floor code are not in the diff.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 4

## Facts Summary

- AC coverage: 11 declared criteria
- Task evidence: 11 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
