---
id: KN-143
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-060 setup --project scaffold + repo ledger (2026-07-21)"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-10-23
tags: []
parent: PLAN-066
links:
  - {id: PLAN-066, type: informs}
---
> ⚠ INVALIDATED 2026-07-21T05:49:43.607Z — superseded by knowledge-assessment-implementation-spec-060-setup-project-sca-2; Assessed against a wrong diff range (main~8..main) that bundled SPEC-059 + a skill rename; its scope_fidelity 38 and both scope gaps are artifacts of orchestrator input error, not implementation drift. Re-run on 65a0534..main scored scope_fidelity 88.

# Assessment: partially_met (78/100)

Scope: plan `01KY1G5DET2XQP3D5QBNCT046W`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-060-1 | 88 | Attested pass (recorder=apple) with output tail on the exact -t filtered test; agent-recorded pass too. Tail shows 1 passed / 6 skipped, consistent with -t filtering. Flow impl truncated so manifest/write-set equality itself is unverifiable beyond the green test. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [5]), task-t1-repo-level-install-ledger-core-d1-projectfsport-backup-r (evidence [1]) |
| AC-060-2 | 88 | Attested pass with output tail on the '0 writer calls' filtered test, plus agent-recorded pass. Idempotence assertion lives entirely in a truncated test file; judged from the exit-code oracle. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [6]), task-t1-repo-level-install-ledger-core-d1-projectfsport-backup-r (evidence [2]) |
| AC-060-3 | 78 | Attested pass, 10/10 tests. But uninstall flow hardcodes PROJECT_MANIFEST_FILENAME/.lore-backups while the CLI imports PROJECT_MANIFEST_RELATIVE_PATH from the flow — the module's own header flags this as an unreconciled assumption. Unit fakes cannot catch a mismatch. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [7]), task-t3-lore-setup-project-uninstall-verb-d2 (evidence [1]) |
| AC-060-4 | 88 | Attested pass, 7/7 tests. gitignore.template visible in diff carries exactly 6 entries under one '# --- lore ---' header, matching the AC's declared count. Append/idempotence logic itself is in the truncated flow file. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [8], [1]) |
| AC-060-5 | 85 | Attested pass, 6/6 tests. Renderer diff confirms loud backup lines print the backup DESTINATION path, and real backupProjectFile is wired into makeRealProjectFs — the stdout-contains-backup-path half is supported by visible code. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [9], [2]) |
| AC-060-6 | 87 | Attested pass, 11/11 tests. Visible diff shows a single PROJECT_NEXT_STEPS SSOT (3 entries) consumed by both the --json branch and the text renderer in runProjectScaffold, directly satisfying the 'same order' requirement. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [10]), task-t4-receipt-next-steps-loud-backup-reporting-d5-d6 (evidence [1]) |
| AC-060-7 | 66 | Attested pass, but the output tail shows only assets-ssot.test.ts ('Test Files 1 passed (1)') of the 3 named suites; setup-service/real-setup-ports results are not visible. No byte-identity diff of the <claude-dir> tree/manifest is evidenced — only test greenness. | task-t2-gitignore-step-d3-claude-md-stub-step-d4-templates (evidence [11]) |

## Gaps

- SPEC-059's requirement-quantifiability feature (packages/core/src/ac-quality.ts lintStatement, config.ts requirement_quantifiable + resolver, requirement-service.ts lint, app.ts wiring, ac-quality.test.ts, requirement-quantifiable-cli.test.ts) is bundled into a diff whose plan covers only SPEC-060 D1–D6. No SPEC-060 task or AC references it, and the plan declares no ac_scope extension.
- assets/skills/lore-session → lore-session-capture rename with corresponding DECLARED_FILES edits in assets-ssot.test.ts and real-setup-ports.test.ts is unrelated to SPEC-060, and it modifies two of the three suites AC-060-7 designates as the untouched regression baseline.
- The attested tail for the 3-suite regression command shows 'Test Files 1 passed (1)' with only assets-ssot.test.ts named; setup-service.test.ts and real-setup-ports.test.ts outcomes are not visible. The AC's byte-identity requirement for the <claude-dir> tree and manifest is not measured by any shown oracle at all.
- setup-project-uninstall.ts hardcodes its manifest filename and backups dirname and self-documents this as an unreconciled assumption against T1's landed setup-project-flow.ts, while commands/setup.ts imports PROJECT_MANIFEST_RELATIVE_PATH from that flow. All uninstall tests use fakes, so a divergence between the two path sources would pass every AC-060-3 test and still fail at runtime.
- Tasks T1, T3, T4 recorded zero attested runs (attested_count=0 each); all 7 attested records come from T2's later batch. Overall attested_evidence_ratio is 0.44.

## Recommendations

- Require that a diff submitted against a plan contain only files traceable to that plan's tasks; unrelated feature work (here, SPEC-059) must land as its own change set or be recorded as an approved scope extension before assessment.
- Strengthen AC-060-7 verification to a mechanical before/after byte comparison of the <claude-dir> tree and manifest, and re-attest the 3-suite command with a tail covering all three suites.
- Add an integration test that runs `lore setup --project --yes` then `lore setup --project --uninstall --yes` against a throwaway git repo with the real fs ports.
- Require attestation on each task's own evidence rather than relying on a single later task's re-run batch to cover all ACs.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 73966ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:assets/project/CLAUDE.md.template, diff:assets/skills/lore-session-capture/SKILL.md, diff:assets/skills/lore-session-review/SKILL.md, diff:assets/skills/lore-session-review/references/invariants.md, diff:packages/lore/src/flows/setup-project-flow.ts, diff:packages/lore/tests/unit/adapters/setup-render-next-steps.test.ts, diff:packages/lore/tests/unit/flows/setup-project-claudemd.test.ts, diff:packages/lore/tests/unit/flows/setup-project-gitignore.test.ts, diff:packages/lore/tests/unit/flows/setup-project-manifest.test.ts, diff:packages/lore/tests/unit/flows/setup-project-uninstall.test.ts, diff:packages/lore/tests/unit/service/requirement-service.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.7 | evidence | All 7 ACs have an attested passing script oracle; visible renderer/args/CLI diff independently corroborates D2/D5/D6. Core flow file truncated, so D1/D3/D4 rest on test greenness alone. |
| evidence_integrity | 72 | 0.65 | evidence | Every AC attested with output tails, no failures. But ratio is 0.44, T1/T3/T4 are fully self-reported, and AC-060-7's tail shows only 1 of 3 named suites. |
| scope_fidelity | 38 | 0.85 | evidence | Diff carries a whole unrelated SPEC-059 feature (lintStatement, config brake, RequirementService, app.ts, new CLI test) plus a skill-asset rename — none in any SPEC-060 task or AC. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | SPEC-059's requirement-quantifiability feature (packages/core/src/ac-quality.ts lintStatement, config.ts requirement_quantifiable + resolver, requirement-service.ts lint, app.ts wiring, ac-quality.test.ts, requirement-quantifiable-cli.test.ts) is bundled into a diff whose plan covers only SPEC-060 D1–D6. No SPEC-060 task or AC references it, and the plan declares no ac_scope extension. |
| scope_fidelity | minor | AC-060-7 | assets/skills/lore-session → lore-session-capture rename with corresponding DECLARED_FILES edits in assets-ssot.test.ts and real-setup-ports.test.ts is unrelated to SPEC-060, and it modifies two of the three suites AC-060-7 designates as the untouched regression baseline. |
| evidence_integrity | major | AC-060-7 | The attested tail for the 3-suite regression command shows 'Test Files 1 passed (1)' with only assets-ssot.test.ts named; setup-service.test.ts and real-setup-ports.test.ts outcomes are not visible. The AC's byte-identity requirement for the <claude-dir> tree and manifest is not measured by any shown oracle at all. |
| outcome | minor | AC-060-3 | setup-project-uninstall.ts hardcodes its manifest filename and backups dirname and self-documents this as an unreconciled assumption against T1's landed setup-project-flow.ts, while commands/setup.ts imports PROJECT_MANIFEST_RELATIVE_PATH from that flow. All uninstall tests use fakes, so a divergence between the two path sources would pass every AC-060-3 test and still fail at runtime. |
| evidence_integrity | minor | — | Tasks T1, T3, T4 recorded zero attested runs (attested_count=0 each); all 7 attested records come from T2's later batch. Overall attested_evidence_ratio is 0.44. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require that a diff submitted against a plan contain only files traceable to that plan's tasks; unrelated feature work (here, SPEC-059) must land as its own change set or be recorded as an approved scope extension before assessment. | Bundled unrelated work makes the regression baseline and the scope claim unverifiable. |
| plan | Strengthen AC-060-7 verification to a mechanical before/after byte comparison of the <claude-dir> tree and manifest, and re-attest the 3-suite command with a tail covering all three suites. | Current evidence proves suite greenness on one visible suite, not byte-identity. |
| plan | Add an integration test that runs `lore setup --project --yes` then `lore setup --project --uninstall --yes` against a throwaway git repo with the real fs ports. | Removes the fake-port blind spot around the duplicated manifest path constants. |
| process | Require attestation on each task's own evidence rather than relying on a single later task's re-run batch to cover all ACs. | T1/T3/T4 each closed with 100% self-reported evidence. |

## Unverifiable Materials

- packages/lore/src/flows/setup-project-flow.ts: Truncated from the diff. D1 ledger, D3 .gitignore step, and D4 CLAUDE.md step logic judged only via passing test oracles, not read.
- The 5 setup-project/*.test.ts and setup-render-next-steps.test.ts files: Truncated. Cannot confirm assertions actually check the exact quantities the ACs state (0 extra/0 missing, 0 writer calls, byte-identity).
- setup-service.test.ts and real-setup-ports.test.ts run results for AC-060-7: Named in the command but absent from the attested output tail, which reports only one test file passing.
- PROJECT_MANIFEST_RELATIVE_PATH's actual value: Exported from the truncated flow file; cannot confirm it equals the .lore/.lore-project-manifest.json literal the uninstall flow hardcodes.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.44
