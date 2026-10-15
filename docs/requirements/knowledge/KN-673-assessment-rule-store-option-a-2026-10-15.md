---
id: KN-673
type: knowledge
role: knowledge
title: "Assessment: Rule store option A (2026-10-15)"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-159
links:
  - {id: PLAN-159, type: informs}
---
# Assessment: met (85/100)

Scope: plan `01M4Q8TRRRRJHF4W7DCBV63KTF`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-RS-1 | 92 | T1 shows a real red (the 1536/1537 and skill-with-description cases failed), then 9/9 pass. The diff's superRefine enforces description, mode static and audience [main], and delivery defaults to rules. Matches the AC. | task-rs-t1-core-fragment-format-delivery-description-skills |
| AC-RS-2 | 91 | T2 red shows skill fragments leaking into rules:project, then 6/6 pass. In select.ts, matchesOutletRouting excludes skills from rules:* and hook:*, and the layer sets route shipped+project to skills:project and user to skills:user. | task-rs-t2-routing-skill-fragments-to-skills-outlets-only |
| AC-RS-3 | 88 | Red was module-missing, then 12/12 pass. selection.ts gives deterministic serialization, unknown-id refusal, ownership through checkOverrides, and a selectionToLayer refusal that names selection.yaml. The red is a weak signal (import failure). | task-rs-t5-selection-model-and-shared-user-config-dir-resolver |
| AC-RS-4 | 88 | Red [1] was a shell syntax error, not a real red. [2] is a genuine red (0 findings vs 2 expected), then 4/4 pass. duplicates.ts compares only within a group and skips same-id pairs and headings/blank lines, which matches the AC. | task-rs-t4-deterministic-duplicate-line-detector |
| AC-RS-5 | 92 | T3 and T7 both show reds, including two mutation reds (prune by prefix only; name/id check dropped), then 10/10 and 11/11 pass. planSkillDirs prunes only fingerprinted dirs and refuses shipped-name collisions before writing anything. | task-rs-t7-refresh-writes-and-prunes-skill-folders, task-rs-t3-skill-file-shape-and-caps |
| AC-RS-6 | 88 | Red was module-missing, then 9/9 pass. runSelectionChange re-reads the file and compares hashes before writing, returning CONFLICT with no write. The window between that re-read and the write remains, but it is narrow. | task-rs-t8-selection-flow-with-cas-write |
| AC-RS-7 | 87 | The e2e red shows exit 2 (verb missing), then 5/5 pass after a build. The CLI adapter context.ts is truncated, so the verb wiring itself is unseen. | task-rs-t10-context-list-add-remove-verbs-and-skill-refresh-via |
| AC-RS-8 | 90 | T6 unit red→33/33 and T9 e2e red→6/6. runFragmentsCheck adds duplicate_line and selection_in_config findings, and any finding makes ok false. The adapter's mapping to exit 4 is truncated but covered by the e2e run. | task-rs-t9-fragments-adapter-loads-selections-via-the-shared, task-rs-t6-fragments-check-flow-gains-duplicate-selection-and |
| AC-RS-9 | 85 | Red: status exit code did not match. Green: 3/3 pass, run once by absolute worktree path and later by relative path. The status.ts adapter is truncated, so the code itself is unseen. | task-rs-t11-lore-status-check-fragments |
| AC-RS-10 | 87 | Red: the pruned skill dir was still present. Green: 3/3 pass. removeDirIfEmpty was added to fs-ports to support this. The adapter wiring is truncated. | task-rs-t10-context-list-add-remove-verbs-and-skill-refresh-via |
| AC-RS-11 | 92 | The mutation red (user selection fed into project outlets) failed, and 3/3 pass. resolveContextConfig maps skills:project to the project layer only. | task-rs-t7-refresh-writes-and-prunes-skill-folders, task-rs-t2-routing-skill-fragments-to-skills-outlets-only |
| AC-RS-12 | 88 | Red: JSON parse failure plus a missing 'tester', then 2/2 pass along with regression suites. The hook .mjs sources are truncated; the manifest hashes were updated and the embed check passes. | task-rs-t12-edit-hook-notice-reaches-the-model-general-agent |
| AC-RS-13 | 82 | 5/5 e2e pass, and fragments check is clean. The expected-fail tail shows rendered content, not an explicit failure assertion. The plan says T13 measures every main-session addition against the 7,000 B budget; no such report is shown. | task-rs-t13-migration-promoted-shipped-fragments-agent-rules |
| AC-RS-15 | 88 | Red: the LORE_CONFIG_HOME fixture was not honoured. Green: 4/4 pass. resolveUserConfigDir uses the precedence LORE_CONFIG_HOME > XDG_CONFIG_HOME/lore > ~/.config/lore. | task-rs-t10-context-list-add-remove-verbs-and-skill-refresh-via |
| AC-RS-14 | 80 | Measured dups=0, bytes=29199 (≤33818), check=0, with a red control giving dups=1. The result is machine-local and came from a human step whose files are outside the repo, so it cannot be independently reproduced. | task-rule-store-close-user-layer-migration-and-ac-rs-14 |

## Gaps

- packages/core/src/fs-ports.ts gains FsWritePort.removeDirIfEmpty, a symbol absent from the plan's census table. It is additive and optional, but it was not censused.
- packages/core/src/context-fragments.ts adds a refinement rejecting ids that start with 'lore-'. No AC or plan task covers this new refusal.
- The first expected-fail run for AC-RS-4 was a /bin/sh syntax error, not a test red. Only the second record is a genuine red.
- Plan close steps (full suite against the 15-failure baseline, BR retirements, anchor adds, D4 issues, lore assess) have no evidence in the materials.
- The plan says T13 reports every addition against the 7,000 B main-session budget. No such measurement record appears in the T13 evidence.

## Recommendations

- Attach close-phase evidence: the full vitest/bun suite on merged main compared against the 15-failure baseline, and every script AC re-run on main.
- Require expected-fail evidence to be an assertion failure on a stub, not a shell syntax error or a missing module.
- Add any newly introduced port methods or schema refinements to the census table, or explain them in the task notes.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 51762ms
- Retried: false
- Truncated sections: diff:packages/core/tests/unit/rs-frontmatter-delivery.test.ts, diff:packages/lore/tests/unit/context-fragments/render.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-duplicates.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-select-skill-routing.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-selection-determinism.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-skill-file-shape.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-selection.test.ts, diff:packages/lore/tests/unit/flows/rs-selection-cas.test.ts, diff:packages/lore/tests/unit/flows/fragments-flow.test.ts, diff:assets/hooks/pre-no-general-agent-gate.mjs, diff:assets/hooks/pre-subagent-gate.mjs, diff:packages/lore/tests/unit/hooks/rs-pre-subagent-gate-message.test.ts, diff:packages/lore/tests/unit/hooks/stop-doc-sync-turn-state.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-refresh-skills.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-selection-determinism.test.ts, diff:packages/lore/tests/unit/context-fragments/rs-skill-file-shape.test.ts, diff:packages/lore/src/adapters/cli/commands/fragments.ts, diff:packages/lore/tests/e2e/rs-fragments-check-duplicates.bun.test.ts, diff:packages/lore/tests/unit/flows/fragments-flow.test.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/tests/e2e/rs-status-check-fragments.bun.test.ts, diff:packages/lore/src/adapters/cli/commands/context.ts, diff:packages/lore/src/adapters/cli/commands/fragments.ts, diff:packages/lore/src/adapters/cli/commands/setup.ts, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/flows/context-flow.ts, diff:packages/lore/tests/e2e/rs-context-selection-cli.bun.test.ts, diff:packages/lore/tests/e2e/rs-skill-delivery-cli.bun.test.ts, diff:packages/lore/tests/e2e/rs-user-config-resolver.bun.test.ts, diff:.claude/rules/lore-ac-design.md, diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-dispatch-bundle.md, diff:.claude/rules/lore-evidence-attestation.md, diff:.claude/rules/lore-project-scoped-oracles-in-worktrees.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:.lore/context/scoped-oracles-in-worktrees.md, diff:assets/context/ac-design.md, diff:assets/context/agent-rules.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/dispatch-bundle.md, diff:assets/context/evidence-attestation.md, diff:assets/context/worktree-dispatch.md, diff:packages/core/tests/unit/rs-frontmatter-delivery.test.ts, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/tests/e2e/rs-shipped-catalog.bun.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/context-fragments/refresh-idempotence.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 87 | 0.75 | evidence | All 15 ACs have red→green or measured pass evidence, and the visible code matches the AC semantics. The adapters are truncated. |
| evidence_integrity | 80 | 0.7 | evidence | Attested ratio is 0.88 with mutation reds for key ACs. Some reds are weak (syntax error, missing module), and AC-RS-14 is machine-local. |
| scope_fidelity | 80 | 0.6 | evidence | Mostly within the anchors. Two additions are outside the census: core fs-ports removeDirIfEmpty and the id 'lore-' prefix refine. Close steps lack evidence. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | minor | — | packages/core/src/fs-ports.ts gains FsWritePort.removeDirIfEmpty, a symbol absent from the plan's census table. It is additive and optional, but it was not censused. |
| scope_fidelity | minor | — | packages/core/src/context-fragments.ts adds a refinement rejecting ids that start with 'lore-'. No AC or plan task covers this new refusal. |
| evidence_integrity | minor | AC-RS-4 | The first expected-fail run for AC-RS-4 was a /bin/sh syntax error, not a test red. Only the second record is a genuine red. |
| outcome | major | — | Plan close steps (full suite against the 15-failure baseline, BR retirements, anchor adds, D4 issues, lore assess) have no evidence in the materials. |
| evidence_integrity | minor | AC-RS-13 | The plan says T13 reports every addition against the 7,000 B main-session budget. No such measurement record appears in the T13 evidence. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Attach close-phase evidence: the full vitest/bun suite on merged main compared against the 15-failure baseline, and every script AC re-run on main. | The per-task greens ran in worktrees; there is no evidence from merged main. |
| prompt | Require expected-fail evidence to be an assertion failure on a stub, not a shell syntax error or a missing module. | The T4, T5 and T8 reds were weak signals. |
| plan | Add any newly introduced port methods or schema refinements to the census table, or explain them in the task notes. | removeDirIfEmpty and the lore- id refine were added without explanation. |

## Unverifiable Materials

- CLI adapters (context.ts, fragments.ts, status.ts, setup.ts) and hook .mjs sources: Truncated from the diff; their wiring is judged only through e2e evidence.
- ~/.config/lore/context user layer on the author's machine: AC-RS-14 depends on machine-local files outside the repo.
- Shipped fragment contents in assets/context/*.md: Truncated; the byte budget and the dedup of promoted lines cannot be inspected.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 15 declared criteria
- Task evidence: 14 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.88
