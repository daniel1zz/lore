---
id: KN-806
type: knowledge
role: knowledge
title: "Milestone review: AC-RL-2 moves off the MCP test file"
status: approved
priority: medium
created: 2026-10-27
updated: 2026-10-27
tags: []
parent: PLAN-249
links:
  - {id: PLAN-249, type: informs}
---
# Milestone review: PASS

Fingerprint: 435d15f60d99d6f9601b01b6ea85265072827d9873d6365426c23b4779e9d17d
Diff: derived from 1 commit(s), excluding 0 merged in from main across the plan's tasks

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | pass | The plan claims a single criterion, AC-RL-2. Trusted runners produced the evidence for it. There is an attested expected-fail run of `report-issue-repeat-warning.test.ts -t 'AC-RL-2'`, taken before the file existed, and an attested pass of the same command tagged (ac AC-RL-2). There is also an attested pass of both test files together and an attested typecheck pass. The new file holds the formatRepeatCheckWarning STATE case, copied unchanged. It covers the clean case (undefined), the unreadable case ('— filed anyway.', one line), and corrupt_lines with retried false and true ('— filed anyway.' / '— recognised from the readable entries.'). There are no milestone decisions waiting for this review. | Attested evidence for task-rl2-t1; diff of packages/lore/tests/unit/adapters/report-issue-repeat-warning.test.ts |
| spec_conformance | pass | The plan and task ask for three things: move the AC-RL-2 formatter cases to report-issue-repeat-warning.test.ts, delete them from mcp-github-filing.test.ts, and make no source change. The diff does exactly that. It removes the formatRepeatCheckWarning import and the STATE case from the MCP file and changes no source file. In the MCP file, the describe title loses only its 'AC-RL-2:' tag, so the criterion no longer resolves to a file that is about to be deleted. The MCP repeat_check_degraded tests stay as they were, and they go away with the MCP server removal. That matches the spec: the MCP surface is being removed, and the CLI-line half of AC-RL-2 is kept. | Plan Goal and task RL2-T1 text; spec 'Acceptance Criteria' and 'Scope' (CLI Warning line) |
| regression | pass | The behaviour at risk is the CLI warning formatter and the MCP repeat_check_degraded field. The formatter is still covered in the new file, and the MCP field tests are still in the MCP file. The full-suite run on main 2a7af7c failed, but no failing file is attributed to this plan. The 7 failing files, such as done-worktree-cleanup and migration-023, belong to other work. This change touches tests only and changes no source. | Full-suite section: 'Failing test files attributed to THIS plan: none' |
| design_necessity | pass | There is one technical choice: move the test so it sits next to the CLI code it tests (report-issue-wiring.ts formatRepeatCheckWarning) and out of a file that is about to be deleted. This keeps an acceptance criterion attached to a live test before its host file is removed. The move adds no new mechanism, and the cases were copied unchanged. | Google Testing Blog / Software Engineering at Google ch. 12: tests organised by the unit under test; Fowler's 'Refactoring' (Move Function / tests follow the code) |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-500 (unknown: no-code-anchors) (The only cited rule, BR-500, has state unknown (no code anchors). That state cannot be contradicted, so this dimension does not apply.) | Cited rule state: BR-500 unknown (no-code-anchors) |
| concurrency_safety | na | The change only moves a pure-function unit test, with no I/O, no shared state and no source changes. No concurrent writers are involved. | Landed diff: test files only |
| security | na | This is a test-only relocation. It adds no input path, credential handling or privilege change. | Landed diff: test files only |
