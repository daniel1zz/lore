---
id: KN-679
type: knowledge
role: knowledge
title: "Assessment: Generate lore-owned agent context from templates and registered variables (2026-10-15)"
status: archived
priority: medium
created: 2026-10-15
updated: 2026-10-23
tags: []
parent: PLAN-185
links:
  - {id: PLAN-185, type: informs}
---
# Assessment: partially_met (76/100)

Scope: plan `01M4ZNJNDM6S6TD7DG17SP1B4N`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CV-1 | 92 | The test file is in the diff and covers every listed case with injected registries: path:line, wrong outlet, missing invocation value, look-alike tokens, and validateRegistry with no throw. Red-then-green was recorded. 24/24 tests pass on main, attested. | task-skill-test-core-variable-expander-red-scenarios, task-skill-implement-core-variable-registry-and-expandtemplate |
| AC-CV-2 | 85 | expandFragments is wired into context-flow selectScopeFragments and fragments-flow selectSafely, before render, check and duplicate detection. 17 tests pass on main, attested. The hook:subagent-start path and the duplicate_line test body are not visible in the diff. bodyLineOffset (frontmatter line… | task-skill-implement-expand-variables-in-fragment-outlets, task-skill-implement-fragment-body-line-offset-is-a-required |
| AC-CV-3 | 88 | claude_dir is the only invocation variable and is allowed only at setup:settings-hook, so the fragment outlets refuse it. The two-HOME byte-identity test passes on main, attested (15 tests). Red evidence was recorded. | task-skill-test-fragment-outlet-expansion-project-determinism |
| AC-CV-4 | 88 | RealAssetSource.load expands skill, agent and hook files through expandInstalledAsset. The spawned setup followed by --check reporting zero drift passes on main, attested. The edit to assets/skills/lore/SKILL.md is not visible in the diff. | task-skill-implement-expand-variables-in-shipped-assets-at |
| AC-CV-5 | 82 | The manifest hashes for SKILL.md and evidence-attestation changed, and the check passes with 8 tests attested. scripts/embed-assets-manifest.mjs is not shown, so I cannot confirm it uses the same expander or that it refuses governance and invocation variables (risk R2). | task-skill-implement-expand-variables-in-shipped-assets-at |
| AC-CV-6 | 85 | The literalPatterns cover the listed spellings, and all 9 scan-set source files now use CAPTURE_TAIL_CHARS. The one recorded failure was a worktree run before T6 added mcp_tool_count; the main run passes (12/12). No agent-name patterns were added, which the plan allowed. | task-skill-implement-replace-hand-copied-lore-facts-with |
| AC-CV-7 | 90 | {{CLAUDE_DIR}} is renamed in core, real-asset-source and setup-service. resolveClaudeDirVariable goes through expandTemplate and fails loud. The golden settings.json matched before and after the change (B3 not triggered). Attested pass on main. | task-skill-implement-route-seat-briefing-and-claude-dir-through, task-skill-test-seat-briefing-and-claude-dir-invocation |
| AC-CV-8 | 85 | The tool-names.ts leaf (B2 path A) is typed through LoreMcpToolName, and registerTools asserts set equality at runtime. lore_schema is added to the set by hand because it uses server.tool directly, which is fragile. The CLAUDE.md edit is not shown, and #209 closure is not evidenced. | task-skill-implement-render-claude-md-code-facts-in-z1-and |

## Gaps

- The verify task records `bun run test:vitest` and `bun run test:bun` as result=fail on main. No later passing run exists, yet the task is archived. This contradicts the exit criterion 'full suite green on main'.
- I cannot confirm that scripts/embed-assets-manifest.mjs hashes through expandInstalledAsset and LORE_CONTEXT_VARIABLES, or that it refuses `{{lore:` in governance assets (R2 mitigation).
- packages/lore/src/adapters/mcp/tools.ts adds lore_schema to registeredNames by hand because it is registered with server.tool directly. Any future direct registration that skips this step would throw at startup instead of being prevented at compile time.
- packages/core/src/context-variables.ts preserves malformed tokens such as `{{lore:Bad}}`, and packages/lore/src/service/context-fragments/expand.ts passes them through. Invariant I1 ('no rendered file contains {{lore:') is therefore not enforced.
- No evidence that the spec anchors were declared, that `lore status --check-drift` exits 0, or that issue #209 was closed.

## Recommendations

- Block archiving of a verify task while any of its full-suite evidence rows has result=fail and no later pass for the same command.
- Tighten I1: after expansion, any remaining `{{lore:` substring at a lore-owned outlet is an error, malformed spellings included.
- Add explicit evidence rows for anchor add, check-drift and #209 closure in the verify task's acceptance criteria.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 45676ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:assets/context/evidence-attestation.md, diff:assets/skills/lore/SKILL.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-feed.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-produce.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/dispatch-bundle.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/evidence-attestation.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-rules/worktree-dispatch.md, diff:packages/lore/tests/fixtures/context-variables/pre-change-settings.json, diff:packages/lore/tests/integration/init-context-skill-retirement.bun.test.ts, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/assets/mcp-tool-count.test.ts, diff:packages/lore/tests/unit/assets/registered-literal-lint.test.ts, diff:packages/lore/tests/unit/build/asset-variables.test.ts, diff:packages/lore/tests/unit/context-fragments/fragment-variables-scope.test.ts, diff:packages/lore/tests/unit/context-fragments/fragment-variables.test.ts, diff:packages/lore/tests/unit/context-fragments/render.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-selection.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-skill-file-shape.test.ts, diff:packages/lore/tests/unit/context-fragments/select.test.ts, diff:packages/lore/tests/unit/service/context-variables-registry.test.ts, diff:packages/lore/tests/unit/service/setup-service.test.ts, diff:packages/lore/tests/unit/setup/asset-install-variables.test.ts, diff:packages/lore/tests/unit/setup/claude-dir-variable.test.ts, diff:scripts/embed-assets-manifest.mjs
- Reasoning clipped for: AC-CV-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 82 | 0.7 | evidence | All 8 ACs pass with attested runs on main and the diff matches the design. The full suite fails on main. |
| evidence_integrity | 68 | 0.7 | evidence | Red-first and attested AC runs are solid. The verify task was archived with full-suite failures and no recorded rerun; the anchor and drift exit evidence is missing. |
| scope_fidelity | 88 | 0.75 | evidence | Changes stay within the corrected Phase 2/3 scope. The added bodyLineOffset task is justified by D3. Seat briefing and Z1 were left out as declared. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The verify task records `bun run test:vitest` and `bun run test:bun` as result=fail on main. No later passing run exists, yet the task is archived. This contradicts the exit criterion 'full suite green on main'. |
| outcome | minor | AC-CV-5 | I cannot confirm that scripts/embed-assets-manifest.mjs hashes through expandInstalledAsset and LORE_CONTEXT_VARIABLES, or that it refuses `{{lore:` in governance assets (R2 mitigation). |
| outcome | minor | AC-CV-8 | packages/lore/src/adapters/mcp/tools.ts adds lore_schema to registeredNames by hand because it is registered with server.tool directly. Any future direct registration that skips this step would throw at startup instead of being prevented at compile time. |
| outcome | minor | AC-CV-2 | packages/core/src/context-variables.ts preserves malformed tokens such as `{{lore:Bad}}`, and packages/lore/src/service/context-fragments/expand.ts passes them through. Invariant I1 ('no rendered file contains {{lore:') is therefore not enforced. |
| evidence_integrity | minor | — | No evidence that the spec anchors were declared, that `lore status --check-drift` exits 0, or that issue #209 was closed. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Block archiving of a verify task while any of its full-suite evidence rows has result=fail and no later pass for the same command. | The verify task here was archived with failing full-suite runs. |
| spec | Tighten I1: after expansion, any remaining `{{lore:` substring at a lore-owned outlet is an error, malformed spellings included. | Byte-preserving malformed tokens contradicts the literal wording of I1. |
| plan | Add explicit evidence rows for anchor add, check-drift and #209 closure in the verify task's acceptance criteria. | These exit criteria have no recorded evidence. |

## Unverifiable Materials

- scripts/embed-assets-manifest.mjs: Omitted from the diff; expander parity and the governance refusal are unseen.
- Outputs of test:vitest / test:bun failures: No tails shown; I cannot tell whether the failures relate to this change.
- CLAUDE.md and assets/skills/lore/SKILL.md edits: Omitted; the hand-typed count removal is confirmed only through the AC-CV-8 test.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 4
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 8 declared criteria
- Task evidence: 13 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.76
