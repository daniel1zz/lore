---
id: KN-256
type: knowledge
role: knowledge
title: "Assessment: Implementation — context verb family (two-zone CLAUDE.md, admission checks, skill retirement) (2026-08-01)"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-088
links:
  - {id: PLAN-088, type: informs}
---
# Assessment: met (85/100)

Scope: plan `01KYH98GVKM0C7KE0NVM1W45TS`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CTX-1 | 92 | Exact AC command green repeatedly; 5 attested passes, 0 fails. Close-out run shows 16 tests passing in context-projection.test.ts. Cannot inspect assertions (no diff) to confirm all five states/idempotency/Z2 truly covered. | task-skill-implement-context-projection-pure-module-parse, task-skill-verify-full-suite-close-out-with-attested-verify-and (16 tests pass, attested) |
| AC-CTX-2 | 90 | RED-then-green pairing documented (14 failed at authoring → 15 pass). 5 attested passes, 0 fails on the exact command. Advisory-vs-deterministic separation asserted only inside the unattestable suite body. | task-skill-test-red-admission-check-suite-for-reference, task-skill-implement-claude-md-check-extensions-deterministic |
| AC-CTX-3 | 84 | 3 attested passes at close-out and post-fix (build-first e2e), 2 attested fails were pre-landing 'no test file matched' runs. Test titles still read '(RED — target D3/D5 behavior)', so titles no longer describe state; only two case names visible in tails. | task-skill-implement-context-facts-collection-flow, task-skill-verify-full-suite-close-out-with-attested-verify-and |
| AC-CTX-4 | 80 | Final attested pass (6 tests). But the refactor task itself recorded two FAILs on existing setup suites (setup-project-claudemd, setup-user-once-marker) with no in-task remediation evidence; greenness only re-established later via other tasks/full suite. | task-skill-implement-setup-project-flow-refactor-to-consume-the (evidence [3][4] result=fail), task-skill-verify-full-suite-close-out-with-attested-verify-and |
| AC-CTX-5 | 83 | 3 attested passes on the exact command; 2 attested fails predate the hook landing. Tail confirms fail-open/within-ceiling cases run, but the over-ceiling trip case and the zero-numeric-literals grep-pin are truncated in every visible tail. | task-skill-implement-guard-hook-asset-registration-skill, task-skill-verify-full-suite-close-out-with-attested-verify-and |
| AC-CTX-6 | 86 | Attested pass of the compound command including manifest --check OK (294 files, digest shown) plus fresh-install and prior-install-removal cases visible in the tail. 2 attested fails are pre-landing no-match runs. | task-skill-implement-guard-hook-asset-registration-skill, task-skill-verify-full-suite-close-out-with-attested-verify-and |
| AC-CTX-7 | 90 | `bun run typecheck && bun run test` attested pass 5×, including after both post-close-out hardening tasks. Tail shows unrelated suites passing; no aggregate pass/fail summary line is visible, so total-suite greenness rests on the exit-0 chaining. | task-skill-verify-full-suite-close-out-with-attested-verify-and, task-skill-implement-gitignore-aware-module-walk-refresh-pre |
| AC-CTX-8 | 76 | Now 2 attested passes (12 tests). But the AC was first declared satisfied while the flow used schema defaults instead of config — a real behavioral miss caught only by a later live check, showing the AC's own oracle did not detect the SSOT violation it names. | task-skill-implement-plumb-configured-memory-file-budgets-into (config-gap fix, RED-first), task-skill-implement-gitignore-aware-module-walk-refresh-pre |
| AC-CTX-9 | 80 | 2 attested passes (13 tests in context-facts.test.ts) after a RED-first suite task. No-child_process and FsReadPort-only constraints, and the negation-pattern semantics, are unverifiable without the diff; RED task's own evidence is self-reported only. | task-skill-test-red-walk-hygiene-refresh-admission-suites-ac (self-reported RED), task-skill-implement-gitignore-aware-module-walk-refresh-pre |

## Gaps

- diff_available=false and attested_evidence_ratio=0.53. Structural requirements embedded in the ACs — splice SSOT (no second marker-splice impl), hook containing zero numeric budget literals, walk using FsReadPort only with no child_process, Z2 byte preservation — are only inferable from exit codes of suites whose bodies are not in the materials.
- AC-CTX-8 was recorded green while contextRefresh resolved budgets from schema defaults (300L/30720B) rather than the repo config (220L/24576B) that `lore status --check-claude-md` uses — the exact SSOT the AC names. The oracle passed anyway; only a live manual check exposed it. Fixed in a follow-up task with a RED-first override case, but the AC's oracle strength is proven weak.
- The setup-project-flow refactor task released with evidence [3] (setup-project-claudemd.test.ts) and [4] (setup-user-once-marker.bun.test.ts) recorded result=fail and no paired green re-run in the same task. AC-CTX-4 requires the existing setup e2e suite to stay green; that is only satisfied transitively by later tasks' runs.
- Passing test titles still read 'RED today: the paired implement task has not landed it yet' and '(RED — target D3/D5 behavior)'. The output tails therefore assert the opposite of the recorded state, and the decisive over-ceiling trip case plus the grep-pin case are cut off in every visible tail.
- RED-authoring tasks record oracle=manual with result=pass for runs that were intended to fail (e.g. '14 failed | 1 passed'). This inverts the result field's meaning and makes red-before-green unverifiable mechanically.

## Recommendations

- Block release of an implement task whose evidence set contains a result=fail oracle unless the same command is later re-recorded as pass within that task.
- For any AC phrased as 'same X source as <other command>', require the verify command to include a case with a non-default config override, not just default-resolution cases.
- Introduce a distinct evidence result value (e.g. red) for RED-authoring runs instead of oracle=manual/result=pass, and require the failing-assertion tail to be stored.
- Attach the implementation diff (or at least the grep-pin outputs for splice-SSOT, hook numeric literals, and child_process absence) to the close-out task's evidence.
- Rename suite/case titles containing 'RED' once the paired implement task lands, as part of the implement task's checklist.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 71306ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.72 | evidence | All 9 ACs end with attested passes on their exact commands, including full typecheck+test gates; deductions for one AC that shipped wrong once (AC-CTX-8) and unreadable internals. |
| evidence_integrity | 72 | low | absence | No diff; 0.53 attested ratio; RED runs encoded as result=pass; stale RED titles in green tails; several tails truncated before the decisive case. |
| scope_fidelity | 84 | 0.65 | evidence | Three tasks beyond the stated three-phase plan (AC-CTX-8/9 suites, budget plumbing) but each traces to a declared spec AC and a linked incident retro, so drift is explained. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | diff_available=false and attested_evidence_ratio=0.53. Structural requirements embedded in the ACs — splice SSOT (no second marker-splice impl), hook containing zero numeric budget literals, walk using FsReadPort only with no child_process, Z2 byte preservation — are only inferable from exit codes of suites whose bodies are not in the materials. |
| outcome | major | AC-CTX-8 | AC-CTX-8 was recorded green while contextRefresh resolved budgets from schema defaults (300L/30720B) rather than the repo config (220L/24576B) that `lore status --check-claude-md` uses — the exact SSOT the AC names. The oracle passed anyway; only a live manual check exposed it. Fixed in a follow-up task with a RED-first override case, but the AC's oracle strength is proven weak. |
| evidence_integrity | minor | AC-CTX-4 | The setup-project-flow refactor task released with evidence [3] (setup-project-claudemd.test.ts) and [4] (setup-user-once-marker.bun.test.ts) recorded result=fail and no paired green re-run in the same task. AC-CTX-4 requires the existing setup e2e suite to stay green; that is only satisfied transitively by later tasks' runs. |
| evidence_integrity | minor | AC-CTX-5 | Passing test titles still read 'RED today: the paired implement task has not landed it yet' and '(RED — target D3/D5 behavior)'. The output tails therefore assert the opposite of the recorded state, and the decisive over-ceiling trip case plus the grep-pin case are cut off in every visible tail. |
| evidence_integrity | minor | — | RED-authoring tasks record oracle=manual with result=pass for runs that were intended to fail (e.g. '14 failed \| 1 passed'). This inverts the result field's meaning and makes red-before-green unverifiable mechanically. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Block release of an implement task whose evidence set contains a result=fail oracle unless the same command is later re-recorded as pass within that task. | AC-CTX-4's refactor shipped with two failing neighbour suites; greenness was only re-established incidentally by downstream tasks. |
| spec | For any AC phrased as 'same X source as <other command>', require the verify command to include a case with a non-default config override, not just default-resolution cases. | AC-CTX-8 passed its oracle while ignoring .lore/config.yaml — the defect the AC text was written to prevent. |
| process | Introduce a distinct evidence result value (e.g. red) for RED-authoring runs instead of oracle=manual/result=pass, and require the failing-assertion tail to be stored. | Current encoding makes TDD pairing unauditable and inflates the apparent pass count. |
| plan | Attach the implementation diff (or at least the grep-pin outputs for splice-SSOT, hook numeric literals, and child_process absence) to the close-out task's evidence. | Three ACs assert structural properties that exit codes alone cannot demonstrate to a reviewer. |
| process | Rename suite/case titles containing 'RED' once the paired implement task lands, as part of the implement task's checklist. | Stale titles in passing output tails actively mislead future auditors reading the evidence. |

## Unverifiable Materials

- Implementation diff (diff_available=false): No source changes provided; purity, SSOT, marker grammar, fingerprint derivation and IO-boundary claims cannot be inspected.
- Bodies of context-projection.test.ts, claude-md-admission.test.ts, context-facts.test.ts, context-flow.test.ts, setup-splice-ssot.test.ts: Only pass counts and truncated tails are shown; whether the assertions actually cover the AC dimensions is unverified.
- assets/hooks/claude-md-guard.sh contents: The zero-numeric-budget-literals grep-pin and fail-open branch are asserted only inside a suite whose relevant output is truncated.
- Full-suite aggregate summary for `bun run typecheck && bun run test`: Tails show unrelated passing cases but no total pass/fail counts; AC-CTX-7 rests on exit-code chaining alone.

## Rubric Warnings

- Dimension "evidence_integrity" scored based_on="absence" but no matching entry was found in unverifiable[] or judgment.truncated[] — the absence claim is ungrounded.

## Facts Summary

- AC coverage: 9 declared criteria
- Task evidence: 15 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 4 docs (bundle)
- Regression: tests_touched=false, attested_evidence_ratio=0.53
