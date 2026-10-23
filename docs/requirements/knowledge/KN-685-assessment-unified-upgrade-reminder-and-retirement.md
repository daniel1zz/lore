---
id: KN-685
type: knowledge
role: knowledge
title: "Assessment: Unified upgrade reminder and retirement of the session-start fragment hook (2026-10-15)"
status: archived
priority: medium
created: 2026-10-15
updated: 2026-10-23
tags: []
parent: PLAN-182
links:
  - {id: PLAN-182, type: informs}
---
# Assessment: met (80/100)

Scope: plan `01M4ZE26D5B4V12X6MMNV2YJ9T`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-UR-1 | 84 | 10 tests passed on main (evidence [6] and [7]), above the >=8 floor, with red recorded first. One attested fail [4] after a pass: an ENOENT on hooks/g2-spec-promote.sh, from the concurrent gate-hook retirement. Later runs passed. checkProjectLedger and the shared cache shape are visible in the diff. | task-skill-implement-lore-setup-project-check-classifies-every (evidence [1] expected-fail, [4] fail, [6]/[7] pass on main) |
| AC-UR-2 | 78 | 8 tests passed on main (evidence [4], floor 6), with red recorded first. The implementation file assets/hooks/session-start-resume.mjs is in the truncated section, so the one-line advisory logic cannot be inspected. The task has no typecheck evidence. | task-skill-implement-session-start-resume-emits-one-directive (evidence [1] expected-fail, [4] pass on main) |
| AC-UR-3 | 92 | Red first, then 4 tests passed on main several times. The diff shows hook:session-start removed from OUTLET_IDS, select.ts and render.ts, and an explicit 'retired' usage error in fragments.ts that exits 2. Helper-start rendering is unchanged. | task-skill-implement-retire-the-hook-session-start-outlet-and (evidence [1] red; [8], [11] and [14] pass) |
| AC-UR-4 | 92 | Red first, then 4 tests passed on main. The diff adds checkDynamicMainFragments, which emits a VALIDATION_ERROR naming the fragment id and path, and wires it into runFragmentsCheck, so check exits 4. | task-skill-implement-retire-the-hook-session-start-outlet-and (evidence [2] red; [9], [12] and [15] pass) |
| AC-UR-5 | 88 | Red first (the install test failed), then 4 tests passed on main. The diff removes the hook from HOOK_REGISTRATIONS and from the assets manifest. The convergence logic that removes ledger entries is not visible in the diff, and the passing test is the only proof of it. | task-skill-implement-retire-the-hook-session-start-outlet-and (evidence [3] red; [10], [13] and [16] pass) |

## Gaps

- The landing task's only evidence is a lore verify run scoped with --task. Nothing records bun run test:vitest, bun run test:bun or bun run typecheck passing on main after merge, as the exit criteria and invariant I4 require.
- Changes from other specs are in this diff: UPSTREAM_APPROVED_STATUSES in packages/core/src/task-workflow.ts, the LORE_MCP_TOOL regex in packages/lore/src/adapters/cli/commands/run.ts, and gate hook removal in packages/core/src/distribution-hooks.ts.
- deriveSetupCheckReasons in packages/lore/src/adapters/cli/setup-check.ts tells settings entries apart from files with a '#' substring match. A managed file path containing '#' would get settings_changed instead of binary_version_changed.

## Recommendations

- Require the verify task to attest the full-suite and typecheck runs on main as separate oracle evidence, and to run lore verify at plan scope.
- When sibling plans land in the same commit range, list their commits so the assessment diff covers only this plan's changes.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 40817ms
- Retried: false
- Truncated sections: diff:.claude/settings.json, diff:.lore/export-index.json, diff:CLAUDE.md, diff:assets/hooks/lore-gate-g1-spec-create.sh, diff:assets/hooks/lore-gate-g2-spec-promote.sh, diff:assets/hooks/lore-gate-g3-plan-promote.sh, diff:assets/hooks/lore-gate-g4-task-claim.sh, diff:assets/hooks/post-edit-mark.mjs, diff:assets/hooks/pre-tool-harness-run.mjs, diff:assets/hooks/user-prompt-turn-start.mjs, diff:assets/project/g1-spec-create.sh, diff:assets/project/g2-spec-promote.sh, diff:assets/project/g3-plan-promote.sh, diff:assets/project/g4-task-claim.sh, diff:hooks/g1-spec-create.sh, diff:hooks/g2-spec-promote.sh, diff:hooks/g3-plan-promote.sh, diff:hooks/g4-task-claim.sh, diff:packages/lore/tests/integration/cli/setup-project-check.test.ts, diff:packages/lore/tests/integration/cli/setup.test.ts, diff:packages/lore/tests/integration/gate-hooks.bun.test.ts, diff:packages/lore/tests/integration/gates/active-spec-counts-as-approved.bun.test.ts, diff:packages/lore/tests/integration/gates/gate-hook-retirement-parity.bun.test.ts, diff:packages/lore/tests/integration/hooks/harness-run-any-server-name.test.ts, diff:packages/lore/tests/integration/hooks/hook-harness.ts, diff:packages/lore/tests/integration/hooks/turn-record-agent-id.test.ts, diff:packages/lore/tests/integration/hooks/turn-start-snapshot.test.ts, diff:packages/lore/tests/integration/setup-check.bun.test.ts, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/adapters/setup-render-next-steps.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/unit/core/plan-update.test.ts, diff:packages/lore/tests/unit/flows/setup-project-gitignore.test.ts, diff:packages/lore/tests/unit/flows/setup-project-manifest.test.ts, diff:packages/lore/tests/unit/flows/setup-project-uninstall.test.ts, diff:packages/lore/tests/unit/hooks/content-file-path-guard.test.ts, diff:packages/lore/tests/unit/hooks/gate-cross-corpus-fix.test.ts, diff:packages/lore/tests/unit/service/gate-predicates.test.ts, diff:packages/lore/tests/unit/service/project-setup-service.test.ts, diff:packages/lore/tests/unit/service/setup-service.test.ts, diff:packages/lore/tests/unit/service/upstream-approved-cross-check.test.ts, diff:assets/hooks/session-start-fragments.mjs, diff:packages/core/tests/unit/context-fragments.test.ts, diff:packages/lore/tests/e2e/context-fragments-compiled.bun.test.ts, diff:packages/lore/tests/e2e/rs-fragments-check-duplicates.bun.test.ts, diff:packages/lore/tests/e2e/rs-skill-delivery-cli.bun.test.ts, diff:packages/lore/tests/e2e/rs-status-check-fragments.bun.test.ts, diff:packages/lore/tests/integration/cli/fragments-check-dynamic-refused.test.ts, diff:packages/lore/tests/integration/cli/fragments-session-start-retired.test.ts, diff:packages/lore/tests/integration/cli/setup-retires-session-start-fragments.test.ts, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/context-fragments/render.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-select-skill-routing.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-skill-file-shape.test.ts, diff:packages/lore/tests/unit/context-fragments/select.test.ts, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/unit/flows/fragments-flow.test.ts, diff:packages/lore/tests/unit/service/setup-service.test.ts, diff:assets/hooks/session-start-resume.mjs, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/tests/integration/hooks/session-start-upgrade-advisory.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.75 | evidence | All 5 ACs passed on main, each with red recorded first. The diff matches the planned approach for the shared cache, outlet retirement, dynamic_main finding and roster removal. |
| evidence_integrity | 70 | 0.7 | evidence | Every AC is attested with red then green. The verify task lacks full-suite and typecheck evidence on main, and AC-UR-1 has one interleaved attested fail. |
| scope_fidelity | 62 | 0.65 | evidence | The diff includes active-spec gate changes, g1-g4 hook retirement and MCP-regex changes that belong to sibling plans. None of them is explained in this plan. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The landing task's only evidence is a lore verify run scoped with --task. Nothing records bun run test:vitest, bun run test:bun or bun run typecheck passing on main after merge, as the exit criteria and invariant I4 require. |
| scope_fidelity | minor | — | Changes from other specs are in this diff: UPSTREAM_APPROVED_STATUSES in packages/core/src/task-workflow.ts, the LORE_MCP_TOOL regex in packages/lore/src/adapters/cli/commands/run.ts, and gate hook removal in packages/core/src/distribution-hooks.ts. |
| outcome | minor | AC-UR-2 | deriveSetupCheckReasons in packages/lore/src/adapters/cli/setup-check.ts tells settings entries apart from files with a '#' substring match. A managed file path containing '#' would get settings_changed instead of binary_version_changed. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the verify task to attest the full-suite and typecheck runs on main as separate oracle evidence, and to run lore verify at plan scope. | The exit criteria require these runs, and nothing in the evidence shows they happened. |
| plan | When sibling plans land in the same commit range, list their commits so the assessment diff covers only this plan's changes. | Unrelated changes lower the scope fidelity score and make review harder. |

## Unverifiable Materials

- assets/hooks/session-start-resume.mjs: The AC-UR-2 implementation is in the truncated section, so it can only be judged from its tests.
- test files for AC-UR-1 to AC-UR-5: The test bodies are truncated, so it is not possible to check that the assertions cover each clause of the ACs (for example, the tree-hash-identical check).

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 4 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.82
