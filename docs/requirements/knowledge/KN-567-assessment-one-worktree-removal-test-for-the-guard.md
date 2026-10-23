---
id: KN-567
type: knowledge
role: knowledge
title: "Assessment: One worktree-removal test for the guard, lore done and a sweep (2026-10-12)"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-23
tags: []
parent: PLAN-152
links:
  - {id: PLAN-152, type: informs}
---
# Assessment: met (81/100)

Scope: plan `01M4QEV7SPBB6MTSP2J97Y0HNN`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-WS-1 | 90 | RED [1] (module missing) then 3 passing runs (27 tests). The shown decideWorktreeRemoval matches clauses a-h. WorktreeRemovalFacts has no time field, so (i) holds by type. An unknown caller is never mine. The foreign-live-session clause is present. | task-single-worktree-removal-test-used-by-the-hook-lore-done (evidence [1],[6],[17],[26]) |
| AC-WS-2 | 85 | RED [2] then passes on the compiled binary after build [27] (18 tests). worktree.ts check/sweep is shown and sweep without --apply only reports. worktree-removal-service.ts is omitted, so the removal mechanics and the hint text could not be inspected. | task-single-worktree-removal-test-used-by-the-hook-lore-done (evidence [2],[7],[18],[27]) |
| AC-WS-3 | 82 | RED [3] showed recent-activity where foreign-live-session was expected, then 6 passes after build [28]. done.ts wires callerSession. worktree-cleanup.ts and task-workflow-service.ts are omitted, so the cleanup path is only inferred from tests and the AC-WS-5 grep. | task-single-worktree-removal-test-used-by-the-hook-lore-done (evidence [3],[8],[19],[28]) |
| AC-WS-4 | 80 | RED [4] against the old hook, then 22 hook tests pass, including the spawn of 'lore worktree check ... --session ... --json'. The hook file itself (pre-bash-git-safety-gate.mjs) is omitted. The claims about the lsof spy and the foreign-live-session block could not be checked against code. | task-single-worktree-removal-test-used-by-the-hook-lore-done (evidence [4],[9],[20],[29]) |
| AC-WS-5 | 88 | Measured RED (28 hits), then the grep is clean and the manifest check is OK. The diff shows a single lsof scan in real-process-scan-port.ts and the manifest hook sha updated. The grep only covers the two named files by design. | task-single-worktree-removal-test-used-by-the-hook-lore-done (evidence [5],[10],[21],[30]) |
| AC-WS-6 | 92 | bun run typecheck passes three times. The output tail is truncated at the dashboard step, but each run is attested as a pass. | task-single-worktree-removal-test-used-by-the-hook-lore-done (evidence [11],[22],[31]) |

## Gaps

- Unrelated features appear in the diff with no plan entry: test-title anchors in packages/core/src/code-anchors.ts, commit-range attribution in packages/lore/src/adapters/cli/assess-commit-derivation.ts and packages/lore/src/service/task-commit-range.ts, the stderr merge in packages/lore/src/service/merged-stream-command.ts, and the ac-service edit-skip in packages/lore/src/service/ac-service.ts.
- packages/lore/src/app.ts wires the removal service into TaskWorkflowService by passing four positional undefined arguments before argument 14. A future change to the constructor signature could silently mis-wire it, and lore done would then report every worktree as not-measured.

## Recommendations

- Keep each assessed diff limited to its plan's tasks. Land the #178/#179/#180/#181 and ready-counts work under their own plans.
- Add a structural check (a type or test) that both composition roots pass a WorktreeRemovalFactsPort to TaskWorkflowService.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 30254ms
- Retried: false
- Truncated sections: diff:.claude/rules/lore-corpus-workflow-close.md, diff:.claude/rules/lore-evidence-attestation.md, diff:.claude/rules/lore-worktree-dispatch.md, diff:assets/context/corpus-workflow-4-close.md, diff:assets/context/evidence-attestation.md, diff:assets/context/worktree-dispatch.md, diff:assets/hooks/pre-bash-git-safety-gate.mjs, diff:assets/skills/lore-autopilot/SKILL.md, diff:packages/core/tests/code-anchors.test.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/src/service/worktree-cleanup.ts, diff:packages/lore/src/service/worktree-removal-service.ts, diff:packages/lore/tests/e2e/done-worktree-cleanup-compiled.bun.test.ts, diff:packages/lore/tests/e2e/worktree-check-sweep-compiled.bun.test.ts, diff:packages/lore/tests/integration/cli/anchor-test-title.bun.test.ts, diff:packages/lore/tests/integration/cli/done-worktree-cleanup.bun.test.ts, diff:packages/lore/tests/integration/cli/worktree-sweep.bun.test.ts, diff:packages/lore/tests/integration/verify-executor-single-stream.bun.test.ts, diff:packages/lore/tests/unit/adapters/assess-commit-derivation.test.ts, diff:packages/lore/tests/unit/adapters/assess-recorded-commit-range.test.ts, diff:packages/lore/tests/unit/adapters/caller-session.test.ts, diff:packages/lore/tests/unit/adapters/evidence-capture-single-stream.test.ts, diff:packages/lore/tests/unit/adapters/http/routes.test.ts, diff:packages/lore/tests/unit/adapters/mcp-session-registry.test.ts, diff:packages/lore/tests/unit/adapters/mcp-tools-task-workflow.test.ts, diff:packages/lore/tests/unit/adapters/real-process-scan-port.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/hooks/git-safety-worktree-check.test.ts, diff:packages/lore/tests/unit/hooks/git-safety-worktree-occupancy.test.ts, diff:packages/lore/tests/unit/service/ac-set.test.ts, diff:packages/lore/tests/unit/service/ready-counts.test.ts, diff:packages/lore/tests/unit/service/task-done-commit-range.test.ts, diff:packages/lore/tests/unit/service/worktree-cleanup.test.ts, diff:packages/lore/tests/unit/service/worktree-removal-service.test.ts, diff:packages/lore/tests/unit/service/worktree-removal-test.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.7 | evidence | All six ACs went red then green. The pure decision module visibly matches D1/D2/D5. The service, cleanup and hook bodies are unseen. |
| evidence_integrity | 84 | 0.75 | evidence | Measured red-first for every AC, then attested passes, including a rebuilt binary for the e2e tests. 5 entries are self-reported, and some tails are truncated. |
| scope_fidelity | 40 | 0.7 | evidence | The diff contains several unrelated features (#178 test-title anchors, #179, #180 commit ranges, #181 stream merge, ready counts) that this one-task plan does not mention. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | Unrelated features appear in the diff with no plan entry: test-title anchors in packages/core/src/code-anchors.ts, commit-range attribution in packages/lore/src/adapters/cli/assess-commit-derivation.ts and packages/lore/src/service/task-commit-range.ts, the stderr merge in packages/lore/src/service/merged-stream-command.ts, and the ac-service edit-skip in packages/lore/src/service/ac-service.ts. |
| outcome | minor | AC-WS-3 | packages/lore/src/app.ts wires the removal service into TaskWorkflowService by passing four positional undefined arguments before argument 14. A future change to the constructor signature could silently mis-wire it, and lore done would then report every worktree as not-measured. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Keep each assessed diff limited to its plan's tasks. Land the #178/#179/#180/#181 and ready-counts work under their own plans. | Mixed diffs make it impossible to assess scope fidelity and attribute regressions. |
| plan | Add a structural check (a type or test) that both composition roots pass a WorktreeRemovalFactsPort to TaskWorkflowService. | Positional undefined wiring is fragile. |

## Unverifiable Materials

- packages/lore/src/service/worktree-removal-service.ts: Omitted. The fact gathering, sweep --apply removal, and the never-force / branch -d behaviour (I3) are not visible.
- packages/lore/src/service/worktree-cleanup.ts: Omitted. The lore done cleanup's use of the single test is checked only via the grep and e2e tests.
- assets/hooks/pre-bash-git-safety-gate.mjs: Omitted. The hook's delegation to lore worktree check and its unchanged refusal texts (I1) are not visible.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.85
