---
id: KN-684
type: knowledge
role: knowledge
title: "Assessment: Interception moves off every tool call: turn-end review and gate-hook retirement (2026-10-15)"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-181
links:
  - {id: PLAN-181, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01M4ZE26SQGZ87CYSBADA2RX8F`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-TE-1 | 87 | The declared parity command passed twice (≥9 bun passes). Red was recorded with retirement-grep offenders. Evidence [2] shows the refusal and control cases passed before deletion, which honours R1's ordering. The MCP-side assertions are in a test file not shown in the diff. | task-skill-implement-retire-the-g1-g4-checkpoint-hooks-after (evidence [1] expected-fail, [2] refusals pre-delete, [3]/[6] declared command pass) |
| AC-TE-2 | 80 | turn-record-agent-id.test.ts passes (5 tests), including the main-session control that blocks. The originating task's red evidence has ac_ref=(none) and no tail shown, and its pass used a directory glob, not the declared AC command. Later passes are plain vitest runs, not the declared script. | task-skill-implement-the-turn-record-carries-the-editing-agent ([1] red ac_ref none, [2]/[4] pass), task-skill-implement-stop-turn-review-reviews-the-main-session ([7] 5 tests pass) |
| AC-TE-3 | 90 | 16 tests cover every clause: no edits, stop_hook_active, default off, block naming 'implementer', the 2- and 4-line allowance, .claude/ and .json exemptions, one block for two findings, and 'not measured'. Red was recorded first and the declared command was run on main. | task-skill-implement-stop-turn-review-reviews-the-main-session ([1] red, [4]/[9]/[12]/[15] pass) |
| AC-TE-4 | 87 | 8 tests cover Bash rm, git mv, a present anchor, pre-existing drift, and over/in-budget CLAUDE.md, plus a control for an untouched over-budget file. Red was recorded first. The fixtures shell out to whatever `lore` is on PATH, not a pinned build. | task-skill-implement-stop-turn-review-reviews-the-main-session ([2] red, [5]/[10]/[13]/[16] pass) |
| AC-TE-5 | 72 | The roster diff swaps stop-doc-sync and claude-md-guard for stop-turn-review, and the declared command passed (6 tests). The test file and .claude/settings.json are not shown. pre-no-general-agent-gate and pre-dispatch-isolation-gate still ship as deny-capable PreToolUse assets, which conflicts wit… | task-skill-implement-the-shipped-roster-and-this-repo-s ([1] red, [2]/[5] pass) |
| AC-TE-6 | 90 | run.ts now matches the server-agnostic /^mcp__.+__lore_\w+$/. The declared command (build + REAL_BINARY_NO_STUB grep) passed on main with 9 tests. Red was recorded twice, including for the added real-binary block. | task-skill-implement-pre-tool-harness-run-rewrites-lore-tool ([1]/[4] red, [8] declared command pass) |
| AC-TE-7 | 90 | Tests show a byte-identical real index, a tree id recorded, no re-report of earlier 50 lines, and exactly one finding naming only another.ts. Red was recorded first and the declared command passed on main. Whether the R2 snapshot duration is recorded cannot be seen. | task-skill-implement-stop-turn-review-reviews-the-main-session ([3] red, [6]/[11]/[14]/[17] pass) |

## Gaps

- The landing task's AC requires `lore verify <plan>` exit 0 plus bun run test:vitest, test:bun and typecheck green on main. Its only evidence is `lore verify` scoped with --task to the stop-turn-review task.
- AC-TE-5 says no shipped PreToolUse/PostToolUse hook other than git safety can deny. The manifest still ships hooks/pre-no-general-agent-gate.mjs and hooks/pre-dispatch-isolation-gate.mjs, which deny dispatches, though they are excluded from the roster.
- AC-TE-2's red evidence was recorded with ac_ref=(none) and no output tail. The pass runs used a directory glob or plain vitest instead of the declared AC script with its ≥3 count check.
- The landing steps (restate BR-1089/BR-1090, add anchors, enable workflow.turn_end.main_session_source_edits locally) have no recorded evidence. R5's mitigation is therefore unverified.

## Recommendations

- Make the landing task's evidence require a plan-wide `lore verify <plan>` and full-suite runs on main, each recorded as a separate oracle.
- Reword AC-TE-5 to 'no registered (roster) PreToolUse/PostToolUse hook ...', or retire the remaining policy deny hooks.
- Require red evidence to carry ac_ref and to use the declared AC command verbatim.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 53878ms
- Retried: false
- Truncated sections: diff:assets/hooks/stop-turn-review.mjs, diff:.claude/settings.json, diff:assets/hooks/claude-md-guard.sh, diff:assets/hooks/lib/turn-state.mjs, diff:assets/hooks/post-edit-mark.mjs, diff:assets/hooks/pre-subagent-gate.mjs, diff:assets/hooks/session-start-marker.mjs, diff:assets/hooks/stop-doc-sync.mjs, diff:assets/hooks/stop-handoff-coverage.mjs, diff:assets/hooks/stop-turn-review.mjs, diff:assets/hooks/user-prompt-turn-start.mjs, diff:packages/lore/tests/integration/cli/setup-turn-end-review-roster.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/unit/hooks/pre-no-general-agent-gate-message.test.ts, diff:packages/lore/tests/unit/hooks/rs-pre-subagent-gate-message.test.ts, diff:packages/lore/tests/unit/hooks/turn-state-producers.test.ts, diff:packages/lore/tests/unit/service/setup-service.test.ts, diff:.claude/settings.json, diff:assets/hooks/lore-gate-g1-spec-create.sh, diff:assets/hooks/lore-gate-g2-spec-promote.sh, diff:assets/hooks/lore-gate-g3-plan-promote.sh, diff:assets/hooks/lore-gate-g4-task-claim.sh, diff:assets/project/g1-spec-create.sh, diff:assets/project/g2-spec-promote.sh, diff:assets/project/g3-plan-promote.sh, diff:assets/project/g4-task-claim.sh, diff:hooks/g1-spec-create.sh, diff:hooks/g2-spec-promote.sh, diff:hooks/g3-plan-promote.sh, diff:hooks/g4-task-claim.sh, diff:packages/lore/tests/integration/cli/setup.test.ts, diff:packages/lore/tests/integration/gate-hooks.bun.test.ts, diff:packages/lore/tests/integration/gates/gate-hook-retirement-parity.bun.test.ts, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/adapters/setup-render-next-steps.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/unit/core/plan-update.test.ts, diff:packages/lore/tests/unit/flows/setup-project-claudemd.test.ts, diff:packages/lore/tests/unit/flows/setup-project-gitignore.test.ts, diff:packages/lore/tests/unit/flows/setup-project-manifest.test.ts, diff:packages/lore/tests/unit/flows/setup-project-uninstall.test.ts, diff:packages/lore/tests/unit/hooks/content-file-path-guard.test.ts, diff:packages/lore/tests/unit/hooks/gate-cross-corpus-fix.test.ts, diff:packages/lore/tests/unit/service/project-setup-service.test.ts, diff:packages/lore/tests/unit/service/setup-service.test.ts, diff:assets/hooks/pre-tool-harness-run.mjs, diff:packages/lore/tests/integration/hooks/harness-run-any-server-name.test.ts, diff:assets/hooks/post-edit-mark.mjs, diff:assets/hooks/user-prompt-turn-start.mjs, diff:packages/lore/tests/integration/hooks/hook-harness.ts, diff:packages/lore/tests/integration/hooks/turn-record-agent-id.test.ts, diff:packages/lore/tests/integration/hooks/turn-start-snapshot.test.ts
- Reasoning clipped for: AC-TE-5

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All 7 AC commands pass with red-first evidence. AC-TE-5's deny clause is ambiguous given the remaining shipped policy gates. |
| evidence_integrity | 68 | 0.65 | evidence | AC evidence is solid, but the landing task attests only a single-task verify. The full suite on main is unevidenced and AC-TE-2's red is not AC-tagged. |
| scope_fidelity | 85 | 0.65 | evidence | Changes follow the task slices. The extra deletions (pre-subagent-gate, claude-md-guard test) are within plan scope. Landing steps were not shown done. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | — | The landing task's AC requires `lore verify <plan>` exit 0 plus bun run test:vitest, test:bun and typecheck green on main. Its only evidence is `lore verify` scoped with --task to the stop-turn-review task. |
| outcome | minor | AC-TE-5 | AC-TE-5 says no shipped PreToolUse/PostToolUse hook other than git safety can deny. The manifest still ships hooks/pre-no-general-agent-gate.mjs and hooks/pre-dispatch-isolation-gate.mjs, which deny dispatches, though they are excluded from the roster. |
| evidence_integrity | minor | AC-TE-2 | AC-TE-2's red evidence was recorded with ac_ref=(none) and no output tail. The pass runs used a directory glob or plain vitest instead of the declared AC script with its ≥3 count check. |
| scope_fidelity | minor | — | The landing steps (restate BR-1089/BR-1090, add anchors, enable workflow.turn_end.main_session_source_edits locally) have no recorded evidence. R5's mitigation is therefore unverified. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Make the landing task's evidence require a plan-wide `lore verify <plan>` and full-suite runs on main, each recorded as a separate oracle. | The current single-task verify does not attest the exit criteria. |
| spec | Reword AC-TE-5 to 'no registered (roster) PreToolUse/PostToolUse hook ...', or retire the remaining policy deny hooks. | As written, the clause conflicts with the shipped policy gate assets. |
| prompt | Require red evidence to carry ac_ref and to use the declared AC command verbatim. | AC-TE-2 red/pass evidence was not tied to the declared script. |

## Unverifiable Materials

- assets/hooks/stop-turn-review.mjs: Hook source omitted; behaviour judged only from tests.
- packages/lore/tests/integration/cli/setup-turn-end-review-roster.test.ts: AC-TE-5 test omitted; cannot confirm the deny-hook and settings.json assertions.
- .claude/settings.json: Omitted; removal of pre-subagent-gate and g1-g4 entries is not directly visible.
- packages/lore/tests/integration/gates/gate-hook-retirement-parity.bun.test.ts: MCP-path refusal assertions are not visible.
- snapshot duration in turn record (R2): No evidence that the duration is recorded or checked.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 3
- Unverifiable (confirmed absent — finding withdrawn): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [minor] The turn-review harness spawns `lore` from PATH (runLore), not the freshly built dist/lore. This makes the AC-TE-3/4 fixtures depend on the host's installed binary. — "packages/lore/tests/integration/hooks/turn-review-harness.ts" not found at commit 20c7dea4937d6a8a6de02a7df530f726ebf826a9

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 6 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.80
