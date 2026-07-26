---
id: KN-118
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-060 setup --project scaffold + repo ledger (2026-07-21)"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-07-24
tags: []
parent: PLAN-066
links:
  - {id: PLAN-066, type: informs}
  - {id: KN-143, type: supersedes}
---
# Assessment: partially_met (68/100)

Scope: plan `01KY1G5DET2XQP3D5QBNCT046W`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-060-1 | 82 | Attested pass (recorder=apple) on the named -t filter; output tail shows 1 passed / 6 skipped, so exactly one focused assertion carries the AC. Test file itself is omitted from the diff, so the 'exactly 0 extra, 0 missing' assertion strength is unverifiable. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [5]), task-t1-repo-level-install-ledger-core-d1-projectfsport-backup-r (evidence [1]) |
| AC-060-2 | 80 | Attested pass, 1 passed / 6 skipped. Flow code plausibly supports 0-writes on rerun (planInstall skip + manifest-content-equality short-circuit), but 'exactly 0 writer calls' assertion is in an omitted test file. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [6]) |
| AC-060-3 | 85 | Attested pass, full suite (10/10) not a -t subset. Uninstall flow module itself is omitted from the diff, so restore-byte-identical behavior is asserted only by unseen tests; CLI wiring to uninstallProject is visible and coherent. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [7]), task-t3-lore-setup-project-uninstall-verb-d2 |
| AC-060-4 | 85 | Attested pass, 7/7 tests. Visible runGitignoreStep logic matches the AC exactly (marker substring check → byte-identical candidate → planInstall skip; existing bytes always a literal prefix). Template contains 6 entries + marker line. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [8]) |
| AC-060-5 | 78 | Attested pass, 6/6. Backup dest path construction is visible and matches .lore/.lore-backups/<iso>/CLAUDE.md. Gap: 'stdout contains that path' is proven at renderer level only; CLI converts to absolute, so the AC's literal path appears as suffix. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [9]) |
| AC-060-6 | 75 | Attested pass, 11/11 on the renderer suite. PROJECT_NEXT_STEPS is a genuine 3-entry SSOT read by both text and --json paths. But the --json emission (backups array, next_steps) is only exercised at renderer level, not via the CLI adapter. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [10]), task-t4-receipt-next-steps-loud-backup-reporting-d5-d6 |
| AC-060-7 | 25 | Attested 'pass' is hollow: its own output_tail shows 1 test file (assets-ssot, 217 tests) — the other two paths matched nothing and vitest still exited 0. The regression claim (setup-service, real-setup-ports unaffected) is therefore unproven, as AC-060-8 concedes. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [11] — tail shows only assets-ssot.test.ts ran) |
| AC-060-8 | 0 | No evidence at all (0 pass, 0 fail). The corrected-path regression run over service/setup-service, assets-ssot, adapters/real-setup-ports was never executed or recorded. The core no-regression claim for the machine-target SetupService path is unattested. | — |

## Gaps

- AC-060-8 has 0 pass / 0 fail — no oracle run exists. It was authored specifically because AC-060-7's paths were wrong; leaving it unrun means the spec's only regression guarantee for the machine-target SetupService install/uninstall path is entirely unevidenced.
- Evidence [11] is attested pass but its output_tail shows exactly one test file (assets-ssot.test.ts, 217 tests). The other two paths (unit/setup-service.test.ts, unit/real-setup-ports.test.ts) do not exist at those locations; vitest exited 0 on a zero-match glob. The attestation is exit-code-derived but semantically false.
- T1, T3, and T4 (5 evidence records) are all recorder=agent:* self-reports with no output tails. Only T2's re-run block is operator-attested. The attested ratio of 0.44 means nearly half the trail is unverified assertion.
- The uninstall flow module is unseen and T5 explicitly defers the real install→uninstall round-trip integration test. Restore-byte-identically and 0-manifest-files-left are proven only against injected fakes, where a real-fs path/permission divergence would not surface.
- AC-060-1 and AC-060-2 each rest on one -t-filtered test with 6 siblings skipped. The remaining 6 tests in that file were never observed passing in any recorded run, so the manifest suite's overall health is unknown.
- The --json branch in runProjectScaffold emits {...receipt, next_steps} with backups mapped to absolute paths, but no evidenced test exercises the CLI adapter — only setup-render.ts. The AC's '--json emits next_steps with >=3 entries and backups as an array' is inferred, not observed.

## Recommendations

- Make the verify oracle reject any test command where the reported 'Test Files' count is lower than the number of file paths passed on the command line, and surface that as a fail rather than a pass.
- Execute and attest AC-060-8's command before treating SPEC-060 as landed, and mark AC-060-7 void/superseded so its misleading pass does not count toward coverage.
- Promote T5 from draft to active and require a real-fs install→uninstall round-trip integration test that exercises backupProjectFile/removeProjectPath and asserts 0 leftover manifest/backup files.
- Require unfiltered suite runs for AC attestation, or require the -t filter's matched-test count to be asserted, instead of accepting '1 passed | 6 skipped' as full coverage.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 71350ms
- Retried: false
- Truncated sections: diff:packages/lore/src/flows/setup-project-uninstall.ts, diff:packages/lore/tests/unit/adapters/setup-args.test.ts, diff:packages/lore/tests/unit/adapters/setup-render-next-steps.test.ts, diff:packages/lore/tests/unit/flows/setup-project-claudemd.test.ts, diff:packages/lore/tests/unit/flows/setup-project-gitignore.test.ts, diff:packages/lore/tests/unit/flows/setup-project-manifest.test.ts, diff:packages/lore/tests/unit/flows/setup-project-uninstall.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 74 | 0.7 | evidence | D1-D6 land coherently in visible code and 6 of 8 ACs carry attested passes; the regression half (AC-060-7/8) is unproven, so no-regression on the machine-target path is unestablished. |
| evidence_integrity | 42 | 0.85 | evidence | AC-060-7's tail proves an oracle passed while matching 1 of 3 suites; AC-060-8 unrun. 56% of evidence is agent self-reported. The trail is verifiably misleading, not merely thin. |
| scope_fidelity | 88 | 0.75 | evidence | Changes map to D1-D6 and touch the anticipated files; the one deletion (AC-046-E.N3 conflict test) is a documented, spec-mandated consequence of D2. No unexplained drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | blocker | AC-060-8 | AC-060-8 has 0 pass / 0 fail — no oracle run exists. It was authored specifically because AC-060-7's paths were wrong; leaving it unrun means the spec's only regression guarantee for the machine-target SetupService install/uninstall path is entirely unevidenced. |
| evidence_integrity | blocker | AC-060-7 | Evidence [11] is attested pass but its output_tail shows exactly one test file (assets-ssot.test.ts, 217 tests). The other two paths (unit/setup-service.test.ts, unit/real-setup-ports.test.ts) do not exist at those locations; vitest exited 0 on a zero-match glob. The attestation is exit-code-derived but semantically false. |
| evidence_integrity | major | — | T1, T3, and T4 (5 evidence records) are all recorder=agent:* self-reports with no output tails. Only T2's re-run block is operator-attested. The attested ratio of 0.44 means nearly half the trail is unverified assertion. |
| outcome | major | AC-060-3 | The uninstall flow module is unseen and T5 explicitly defers the real install→uninstall round-trip integration test. Restore-byte-identically and 0-manifest-files-left are proven only against injected fakes, where a real-fs path/permission divergence would not surface. |
| outcome | minor | AC-060-2 | AC-060-1 and AC-060-2 each rest on one -t-filtered test with 6 siblings skipped. The remaining 6 tests in that file were never observed passing in any recorded run, so the manifest suite's overall health is unknown. |
| outcome | minor | AC-060-6 | The --json branch in runProjectScaffold emits {...receipt, next_steps} with backups mapped to absolute paths, but no evidenced test exercises the CLI adapter — only setup-render.ts. The AC's '--json emits next_steps with >=3 entries and backups as an array' is inferred, not observed. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Make the verify oracle reject any test command where the reported 'Test Files' count is lower than the number of file paths passed on the command line, and surface that as a fail rather than a pass. | AC-060-7 passed attestation while silently running 1 of 3 named suites; exit-code-derived attestation cannot catch a zero-match path on its own. |
| plan | Execute and attest AC-060-8's command before treating SPEC-060 as landed, and mark AC-060-7 void/superseded so its misleading pass does not count toward coverage. | The only remaining regression guarantee for the machine-target SetupService path currently has zero recorded runs. |
| plan | Promote T5 from draft to active and require a real-fs install→uninstall round-trip integration test that exercises backupProjectFile/removeProjectPath and asserts 0 leftover manifest/backup files. | D2's uninstall path is currently proven only against injected fakes; real fs mode/permission behavior is untested. |
| process | Require unfiltered suite runs for AC attestation, or require the -t filter's matched-test count to be asserted, instead of accepting '1 passed \| 6 skipped' as full coverage. | A -t filter that matches nothing also exits 0, the same failure mode that hollowed out AC-060-7. |

## Unverifiable Materials

- packages/lore/src/flows/setup-project-uninstall.ts: Omitted from the diff per the truncation manifest; D2 restore/remove correctness judged only from unseen test results.
- packages/lore/tests/unit/flows/setup-project-manifest.test.ts and the 5 other omitted test files: Omitted from the diff; assertion strength behind AC-060-1..6 (e.g. 'exactly 0 writer calls', byte-identity checks) cannot be inspected.
- Actual on-disk paths of the 3 machine-target setup suites: Cannot confirm the corrected paths in AC-060-8 exist; the only signal is AC-060-7's tail showing 2 of 3 originals matched nothing.

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.44
