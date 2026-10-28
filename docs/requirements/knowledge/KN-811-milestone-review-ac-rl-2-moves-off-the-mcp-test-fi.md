---
id: KN-811
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
| correctness_vs_acs | pass | The plan claims one criterion, AC-RL-2. A trusted runner backs it with an attested expected-fail run before the move, then an attested pass of `report-issue-repeat-warning.test.ts -t 'AC-RL-2'` tagged ac AC-RL-2. Both test files also passed together, and typecheck passed. The diff shows the formatRepeatCheckWarning STATE case moved without changes, so it checks the same four things as before: no warning when clean, the unreadable ending, the corrupt-lines 'filed anyway' ending and the retried ending. There are no milestone decisions to review. | Evidence list for task-rl2-t1; diff of packages/lore/tests/unit/adapters/report-issue-repeat-warning.test.ts |
| spec_conformance | pass | The task says to move the formatter cases to a new CLI-side file, delete them from the MCP file, make no source change and leave the MCP file otherwise unchanged. The diff does exactly this: it adds the new file, removes the formatter `it` block and its now-unused import, and changes no source. The only other edit removes the 'AC-RL-2:' prefix from the remaining MCP describe block. Removing the cases requires this, because otherwise the AC-RL-2 id would still point at the file that the MCP removal deletes. The remaining MCP-field tests stay in that file under BR-500, which is right because the MCP field goes away with the server. | Task RL2-T1 text; plan Goal; spec-remove-the-lore-mcp-server dependency |
| regression | pass | The behaviour at risk is the BR-500 coverage: the CLI warning formatter and the MCP repeat_check_degraded field. The formatter is still covered in the new file and the MCP-field tests are still in the MCP file, and both passed in an attested run. The full suite on main exits 1 and 5, but the report says no failing test file is attributed to this plan. The diff touches only test files and no source. | Full-suite run on main at f582075d; attested combined test:file run |
| design_necessity | pass | The one technical choice is to keep the CLI-formatter test in a file next to the CLI adapter rather than in the MCP adapter's test file, so that it outlives the MCP adapter's deletion. Tests should live with the code under test and be deleted together with it. A second, smaller choice is to drop the AC id from the describe block left in the MCP file so the criterion has a single location. Both follow standard test-organisation practice. | Google Software Engineering at Google, ch. 12 (Unit Testing: tests organised alongside the unit they exercise); Vitest describe/it test organisation |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-500 (unknown: no-code-anchors) (The only cited rule, BR-500, is 'unknown (no-code-anchors)'. It is not contradicted, so this dimension does not apply.) | Cited rule state: BR-500 unknown |
| concurrency_safety | na | The change only moves a test of a pure string formatter. No runtime state, files or processes are touched. | Landed diff (tests only) |
| security | na | The change is test-only with no source change, so no input path, credential or privilege is involved. | Landed diff (tests only) |
