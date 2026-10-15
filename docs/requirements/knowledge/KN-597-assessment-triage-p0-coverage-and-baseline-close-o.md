---
id: KN-597
type: knowledge
role: knowledge
title: "Assessment triage P0 coverage and baseline close-out fixes"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PLAN-165
---
# Assessment triage: P0 coverage plan (73) and baseline close-out fixes (78), 2026-10-10

Triage of `knowledge-assessment-p0-requirement-coverage-falsifying` and `knowledge-assessment-baseline-close-out-fixes-2026-10-10`, by agent:main-orchestrator, each finding machine-checked.

## P0 coverage plan
- MAJOR outcome AC-P0C-2 (whitespace label on CorpusService.create and unknown tree on addNode left out of baseline-field-bounds.test.ts): TRUE at the time, by design — the P0C spec forbade product changes and the task reported both as code violations of BR-613. Resolved in the close-out plan: issues #129/#130 fixed (merge "baseline label and tree validation on both write paths"), the cases were added to the same file, AC-BLC-2 attested pass on main. The assessor read the P0C plan's diff only.
- MAJOR evidence_integrity AC-P0C-7 (isolation e2e failing, later passes with no recorded cause): resolved — root cause recorded on task-fix-multi-project-isolation-e2e-approve-on-project-a: the fixture seeded a draft spec with no review judgment, so the approve gate (BR-281) refused it with 422 NO_JUDGMENT, exactly as a single project would; fix = fixture seeds the judgment (commit 96525516). Assertion not weakened (diff: `expect(approveRes.ok()).toBe(true)` kept, a diagnostic message added).

## Close-out fixes plan
- MAJOR evidence_integrity AC-BLC-3 (test possibly weakened): FALSE — same as above, `git show 96525516` shows the assertion unchanged except its failure message.
- minor AC-BLC-4 (test asserts exit 1 for an unmapped leaf): the test asserts BOTH exit 1 with a site unmapped and exit 0 once the fixture leaf is fully mapped; AC satisfied by the exit-0 case. Separately the live specification branch shows coverage gaps after tonight's new refusal sites — handled by the slice 3b census re-run.
- minor AC-BLC-6 (only a comment changed in rule-service.ts): FALSE — the fix is in adapters/cli/commands/baseline.ts (renderer chooses rows by ruleIdPrefixOfNode); `--json` already carried tallies for every node; AC-BLC-6 attested pass on main.
- minor AC-BLC-8 (baseline-fidelity.bun.test.ts expected-fail with no later pass): closed — a captured pass of that file was recorded on the task (v14).
