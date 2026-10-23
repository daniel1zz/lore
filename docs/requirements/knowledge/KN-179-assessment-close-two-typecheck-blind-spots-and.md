---
id: KN-179
type: knowledge
role: knowledge
title: "Assessment: Close two typecheck blind spots and correct the stale comments that understate them (2026-08-10)"
status: archived
priority: medium
created: 2026-08-10
updated: 2026-10-23
tags: []
parent: PLAN-077
links:
  - {id: PLAN-077, type: informs}
---
# Assessment: met (83/100)

Scope: plan `01KZN4F83SHEP9FT8A5YBZRTX5`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TC-1 | 72 | New tsconfig.e2e.json exists, is wired into the typecheck chain (diff), and resolves 27 tests/e2e files with tsc_exit=0 ([1],[7], 1 attested). Gap: the file-count and chain-membership checks live only as ad-hoc shell commands in evidence, not as a checked-in assertion, so the AC's stated RED is not… | 01KZN4F8ARA3RA6MJBVJFRS8XZ ([1]/[7] listFilesOnly count=27; [6] full chain incl. typecheck:dashboard-e2e passes (ac_ref none, self-reported)) |
| AC-TC-2 | 92 | Diff shows the stale 'those two helper' phrasing replaced with the measured 27-file census (8 .pw.ts + 6 .spec.ts + 13 other) and a pointer to tsconfig.e2e.json; grep oracle returns 0 occurrences ([2],[8], 1 attested). Comment remains greppable. RED is self-evident from the diff. | 01KZN4F8ARA3RA6MJBVJFRS8XZ ([2] stale_phrase_occurrences=0; diff of tsconfig.tests.json) |
| AC-TC-3 | 90 | Durable vitest contract test added; documented RED ([3], exit 2 / 24 errors) and GREEN ([4],[9], attested) both recorded. Fix makes the prerequisite explicit via prebuild. Test moves file aside, restores in finally, asserts byte-identical, plus a CONTROL test proving the counter is non-vacuous. | 01KZN4F8ARA3RA6MJBVJFRS8XZ ([3] expected-fail, [4]/[9] pass, [10] whole-file pass; scripts/tests/typecheck-script-contract.test.ts in diff) |

## Gaps

- The AC requires an assertion that counts the program's resolved file list and a chain-membership assertion whose RED is 'drop the project from the chain and it fails'. No such assertion is in the diff — only a shell one-liner run at evidence time. Dropping typecheck:dashboard-e2e from package.json, or an include that resolves zero e2e files, would go undetected by any checked-in check.
- No expected-fail record exists for AC-TC-1 or AC-TC-2; the exit-0 of the full chain is carried by evidence [6], which is self-reported and tagged ac_ref=(none).
- The test's mkdtemp/rename backup is never read back — restoration writes in-memory originalBytes and then rmSync's the backup dir — so the header comment's claim that the aside-move 'survives even a crash mid-test' is not delivered by the code. The `result` variable is also assigned and unused after the try block.

## Recommendations

- Add a checked-in test asserting (a) root package.json's typecheck chain contains typecheck:dashboard-e2e and (b) `tsc -p packages/dashboard/tsconfig.e2e.json --listFilesOnly` resolves >= 27 files under tests/e2e/, then record its RED by removing the script from the chain.
- Require a recorded expected-fail run for every script-mode AC, not just the one with a ready-made red, before marking the task archived.
- Capture the no-rootDir / bun-types rationale as a linked knowledge doc rather than only as tsconfig comments.

## Judgment

- Provider: claude-cli
- Prompt version: 7
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 64242ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-TC-1

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.8 | evidence | Both gaps closed and both stale comments corrected; diff matches the plan. Deduction: AC-TC-1's required durable file-count/chain assertion was never checked in, only run ad hoc. |
| evidence_integrity | 80 | 0.75 | evidence | Each AC has 2 passes, 1 attested; AC-TC-3 has a genuine RED plus a control test. Weaker: no RED for AC-TC-1/2, and chain-exit-0 evidence is unattested with no ac_ref. |
| scope_fidelity | 95 | 0.88 | evidence | Diff touches only package.json, the two tsconfigs, and the new contract test. Existing exclude left intact as instructed; the bun-types addition is documented with a measured rationale. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-TC-1 | The AC requires an assertion that counts the program's resolved file list and a chain-membership assertion whose RED is 'drop the project from the chain and it fails'. No such assertion is in the diff — only a shell one-liner run at evidence time. Dropping typecheck:dashboard-e2e from package.json, or an include that resolves zero e2e files, would go undetected by any checked-in check. |
| evidence_integrity | minor | AC-TC-1 | No expected-fail record exists for AC-TC-1 or AC-TC-2; the exit-0 of the full chain is carried by evidence [6], which is self-reported and tagged ac_ref=(none). |
| outcome | minor | AC-TC-3 | The test's mkdtemp/rename backup is never read back — restoration writes in-memory originalBytes and then rmSync's the backup dir — so the header comment's claim that the aside-move 'survives even a crash mid-test' is not delivered by the code. The `result` variable is also assigned and unused after the try block. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add a checked-in test asserting (a) root package.json's typecheck chain contains typecheck:dashboard-e2e and (b) `tsc -p packages/dashboard/tsconfig.e2e.json --listFilesOnly` resolves >= 27 files under tests/e2e/, then record its RED by removing the script from the chain. | AC-TC-1 explicitly demands both assertions and names their RED; today only ad-hoc evidence exists, so the blind spot can silently reopen. |
| process | Require a recorded expected-fail run for every script-mode AC, not just the one with a ready-made red, before marking the task archived. | Two of three ACs here have greens with no demonstrated failure mode; tsconfig.tests.json's own history shows exit 0 can mean checking nothing. |
| plan | Capture the no-rootDir / bun-types rationale as a linked knowledge doc rather than only as tsconfig comments. | Zero knowledge docs linked; the comments are the sole carrier of the measured TS6059 storm rationale that future edits must not undo. |

## Unverifiable Materials

- packages/dashboard/package.json `prebuild` script: Not in the diff or materials; its idempotent router-cli generate behavior is inferred from the green AC-TC-3 run only.
- Which specific evidence rows are the 3 attested ones: Facts state 1 attested pass per AC but the rows are not individually marked, so attestation of the full-chain run cannot be confirmed.
- Actual census of packages/dashboard/tests/e2e: The 27-file figure is taken from the tsc --listFilesOnly grep count in evidence; the directory itself is not visible here.

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.30
