---
id: KN-666
type: knowledge
role: knowledge
title: "Assessment: Context fragments: config-driven layered rule injection (2026-10-07)"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PLAN-150
links:
  - {id: PLAN-150, type: informs}
---
# Assessment: met (80/100)

Scope: plan `01M4AGREYVM1JEKG2QPA35RYK9`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CF-1 | 90 | The verbatim AC command passed on main (18 tests). The discover.ts diff shows the id override by layer order and the duplicate-in-layer error naming both paths. A red-first record exists. | task-skill-review-verify-ac-cf-1-21-on-main-full-suite-assess, task-skill-implement-discover-three-layer-fragment-discovery |
| AC-CF-2 | 88 | The AC command passed (28 tests). select.ts matches either the exact subagent:<type> or subagent:*, and applies disable and when filters. A red record exists. | task-skill-review-verify-ac-cf-1-21-on-main-full-suite-assess, task-skill-test-select-red-audience-when-disable-outlet |
| AC-CF-3 | 90 | The AC command passed. render.ts refuses only when chars > cap, and the caps are 9600/9400. BUDGET_EXCEEDED lists each fragment id with its chars. A falsifier on POINTER_CEILING was recorded. | task-skill-review-verify-ac-cf-1-21-on-main-full-suite-assess, task-skill-implement-core-context-fragments-types-schema |
| AC-CF-4 | 85 | The compiled e2e passed (3 tests) on main and in the D15 task. One earlier fail was explained by a cross-task dependency. The final rules-file drift code (fragments-flow.ts after D15) is not visible in the diff. | task-skill-review-verify-ac-cf-1-21-on-main-full-suite-assess, task-skill-implement-d15-static-fragments-as-lore-rules-files |
| AC-CF-5 | 86 | The compiled e2e passed (2 tests). A red record exists (language undefined before the change). claude-settings-port.ts is in the omitted files. | task-skill-implement-setup-language-projection-via |
| AC-CF-6 | 82 | The final run passed (3 tests, 48 expects). The single fail is a superseded pre-D15 run. The prune and diverged_skip falsifiers in the D15 task AC have no recorded evidence. context-flow.ts is omitted. | task-skill-implement-d15-static-fragments-as-lore-rules-files, task-skill-implement-context-refresh-fragments-z1-section-scope |
| AC-CF-7 | 88 | The compiled hook e2e passed. The red record shows the nonce absent while the hook text was still hard-coded. | task-skill-implement-hooks-subagent-subagent-context-becomes-a |
| AC-CF-8 | 87 | The e2e passed repeatedly, including after D15. A red record exists for the missing session-start-fragments registration. | task-skill-implement-hooks-new-session-start-fragments-thin |
| AC-CF-9 | 85 | The e2e passed. The red record shows the YAML boolean being checked. The diff shows only lore-explorer.md; the other agents are in the omitted files. | task-skill-implement-shipped-agents-set-omitclaudemd-true |
| AC-CF-10 | 88 | The e2e passed. The red record shows VALIDATION_ERROR missing from the output. The fragments.ts render path emits a banner and exits 0. | task-skill-implement-hooks-subagent-subagent-context-becomes-a |
| AC-CF-11 | 87 | The e2e passed (2 tests). A red record exists for the missing compact matcher. | task-skill-implement-hooks-new-session-start-fragments-thin |
| AC-CF-12 | 84 | The e2e passed (3 tests, before and after D15). composeSessionStart stays within the cap. The visible diff still shows the pre-D15 Z1-section comparison, and the final version is unseen. | task-skill-implement-d15-static-fragments-as-lore-rules-files |
| AC-CF-13 | 86 | refresh-cas passed (5 tests). A red record exists for CONFLICT. The CAS implementation is in the omitted context-flow.ts. | task-skill-implement-context-refresh-fragments-z1-section-scope, task-skill-test-refresh-cas-red-lost-update-refusal |
| AC-CF-14 | 88 | The AC command passed (3 tests). resolveContextConfig scopes the user outlet to the global layer only, and OUTLET_LAYERS restricts it to the user layer. | task-skill-review-verify-ac-cf-1-21-on-main-full-suite-assess |
| AC-CF-15 | 84 | The e2e passed (1 test, 10 expects). The pass-echo label still says 'inside markers' (stale wording). The implementation is unseen. | task-skill-implement-d15-static-fragments-as-lore-rules-files |
| AC-CF-16 | 90 | The AC command passed. discover.ts rejects '<system-reminder' in any layer and names the file. | task-skill-implement-discover-three-layer-fragment-discovery |
| AC-CF-17 | 87 | The e2e passed (3 tests). Red-first records exist for each re-baselined governance test. governance.ts is in the omitted files. | task-skill-implement-spec-083-amendment-corpus-workflow-prose |
| AC-CF-18 | 86 | The e2e passed (2 tests). checkLanguageDrift names both the actual and the expected value. A red record exists. | task-skill-implement-setup-language-projection-via |
| AC-CF-19 | 86 | The AC command passed (4 tests). OUTLET_LAYERS is disjoint between the project outlet and the user outlet. | task-skill-implement-select-outlet-routing-when-disable-filters |
| AC-CF-20 | 86 | The AC command passed (12 tests). checkOverrides refuses illegal cross-layer overrides and disables of static-main fragments. | task-skill-implement-select-outlet-routing-when-disable-filters |
| AC-CF-21 | 86 | The AC command passed (6 tests). Project outlet selection excludes the user layer and resolves config from the project layer only. | task-skill-implement-select-outlet-routing-when-disable-filters |
| AC-CF-22 | 88 | Red-first records exist for both unit and e2e. Passes followed, and the full context-fragments e2e reached 26/0. Typecheck passed. | task-skill-implement-d16-rules-writes-independent-of-claude-md |

## Gaps

- Exit criteria are unevidenced: the review task is draft, and there are no full-suite or typecheck runs on main, no check-drift, no assess, and no anchors.
- The D15 AC requires falsifier runs (disable prune, overwrite diverged file) that should turn AC-CF-6 red. No evidence of them is recorded.
- The idempotence fix evidence uses scratchpad scripts whose contents are not recorded, so the commands cannot be audited.
- The dogfood evidence is oracle=other with no output tail. Its AC still references a Z1 fragments section, which D15 removed.

## Recommendations

- Do not mark the plan complete until the review task records the full-suite, typecheck, check-drift and assess runs on main.
- Re-baseline the dogfood AC and the pass-echo labels to D15 rules-file terminology.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 51307ms
- Retried: false
- Truncated sections: spec, diff:packages/core/tests/unit/context-fragments.test.ts, diff:packages/lore/tests/e2e/context-fragments-compiled.bun.test.ts, diff:packages/lore/tests/unit/context-fragments/discover.test.ts, diff:packages/lore/tests/unit/context-fragments/render.test.ts, diff:packages/lore/tests/unit/context-fragments/select.test.ts, diff:packages/lore/tests/unit/context-fragments/refresh-cas.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/distribution/assemble.test.ts, diff:scripts/embed-assets-manifest.mjs, diff:scripts/publish-npm.ts, diff:packages/lore/tests/unit/flows/fragments-flow.test.ts, diff:packages/lore/tests/unit/flows/project-pointers-flow.test.ts, diff:assets/context/corpus-workflow-0-overview.md, diff:assets/context/corpus-workflow-1-feed.md, diff:assets/context/corpus-workflow-2-produce.md, diff:assets/context/corpus-workflow-3-execute.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/governance/corpus-workflow.md, diff:packages/lore/src/adapters/cli/commands/governance.ts, diff:packages/lore/src/adapters/real-asset-source.ts, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/tests/e2e/governance-bootstrap-framing-compiled.bun.test.ts, diff:packages/lore/tests/e2e/governance-claude-md-compiled.bun.test.ts, diff:packages/lore/tests/integration/governance-compiled.bun.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/distribution/assemble.test.ts, diff:packages/lore/tests/unit/setup-governance-retirement.test.ts, diff:scripts/ac-ref-exemption-ledger.json, diff:scripts/publish-npm.ts, diff:packages/core/src/errors.ts, diff:packages/lore/src/adapters/cli/commands/context.ts, diff:packages/lore/src/adapters/cli/utils.ts, diff:packages/lore/src/eval/scenarios/placeholder-parse.ts, diff:packages/lore/src/flows/context-flow.ts, diff:packages/lore/src/service/context-fragments/render.ts, diff:assets/hooks/subagent-context.mjs, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/tests/unit/distribution/publish-staging.test.ts, diff:scripts/publish-npm.ts, diff:assets/agents/lore-implementer.md, diff:assets/agents/lore-reviewer.md, diff:assets/context/agent-rules.md, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/src/adapters/claude-settings-port.ts, diff:packages/lore/src/adapters/cli/commands/setup.ts, diff:packages/lore/tests/unit/adapters/claude-settings-port.test.ts, diff:assets/hooks/session-start-fragments.mjs, diff:assets/hooks/session-start-resume.mjs, diff:packages/core/src/distribution-hooks.ts, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts, diff:packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/unit/service/setup-service.test.ts, diff:packages/core/tests/unit/context-fragments.test.ts, diff:packages/lore/tests/e2e/context-fragments-compiled.bun.test.ts, diff:packages/lore/tests/e2e/context-provenance-compiled.bun.test.ts, diff:packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts, diff:packages/lore/tests/unit/context-fragments/refresh-cas.test.ts, diff:packages/lore/tests/unit/context-fragments/refresh-idempotence.test.ts, diff:packages/lore/tests/unit/context-fragments/select.test.ts, diff:packages/lore/tests/unit/flows/fragments-flow.test.ts, diff:packages/core/src/context-fragments.ts, diff:packages/core/src/fs-ports.ts, diff:packages/lore/src/adapters/cli/commands/context.ts, diff:packages/lore/src/adapters/cli/commands/fragments.ts, diff:packages/lore/src/adapters/cli/commands/setup.ts, diff:packages/lore/src/flows/context-flow.ts, diff:packages/lore/src/flows/fragments-flow.ts, diff:packages/lore/src/service/context-fragments/render.ts, diff:packages/lore/src/service/context-fragments/section.ts, diff:packages/lore/src/service/context-fragments/select.ts, diff:packages/lore/tests/unit/context-fragments/render.test.ts, diff:packages/lore/src/adapters/cli/commands/setup.ts, diff:packages/lore/src/flows/context-flow.ts, diff:packages/lore/tests/e2e/context-fragments-compiled.bun.test.ts, diff:packages/lore/tests/unit/context-fragments/refresh-d16.test.ts, diff:.gitignore, diff:.lore/context/no-write-live-corpus.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:.lore/context/test-runner-split.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-corpus-workflow-execute.md, diff:.claude/rules/lore-corpus-workflow-feed.md, diff:.claude/rules/lore-corpus-workflow-overview.md, diff:.claude/rules/lore-corpus-workflow-produce.md

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All 22 ACs have attested passes on main. Exit criteria (full suites, assess, anchors) are not yet evidenced. |
| evidence_integrity | 76 | 0.65 | evidence | Verbatim AC commands are attested and red-first is mostly recorded. Gaps: opaque scratchpad commands, oracle=other dogfood, missing falsifier runs. |
| scope_fidelity | 82 | 0.6 | evidence | D15 and D16 spec amendments were added as tracked tasks. The middleware CONFLICT/BUDGET_EXCEEDED mapping is minor, justified drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | — | Exit criteria are unevidenced: the review task is draft, and there are no full-suite or typecheck runs on main, no check-drift, no assess, and no anchors. |
| evidence_integrity | minor | AC-CF-6 | The D15 AC requires falsifier runs (disable prune, overwrite diverged file) that should turn AC-CF-6 red. No evidence of them is recorded. |
| evidence_integrity | minor | — | The idempotence fix evidence uses scratchpad scripts whose contents are not recorded, so the commands cannot be audited. |
| evidence_integrity | minor | — | The dogfood evidence is oracle=other with no output tail. Its AC still references a Z1 fragments section, which D15 removed. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Do not mark the plan complete until the review task records the full-suite, typecheck, check-drift and assess runs on main. | These are the plan's exit criteria, and none of them has evidence yet. |
| plan | Re-baseline the dogfood AC and the pass-echo labels to D15 rules-file terminology. | Stale Z1 wording makes the evidence misleading. |

## Unverifiable Materials

- Final post-D15 context-flow.ts, fragments-flow.ts, section.ts, select.ts: Omitted from the diff; the visible versions are pre-D15.
- packages/lore/tests/e2e/context-fragments-compiled.bun.test.ts: Omitted test file, so assertion strength cannot be inspected.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 0
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 22 declared criteria
- Task evidence: 24 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.76
