---
id: TASK-834
type: task
role: plan
title: "[Skill:test] repair the two assertions my read-side slice superseded"
status: archived
priority: critical
created: 2026-08-25
updated: 2026-08-25
tags: [repair, supersession, defect-channel]
parent: PRD-001
---
Two pre-existing test assertions were made false by spec-a-github-filed-defect-must-be-claimable-one-ingest-seam deleting the three GitHub-shape refusal stubs. Their governing ACs have already been amended and re-approved (AC-IS-2 on spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired; AC-MS-3 and AC-MS-4 on spec-the-retired-shape-refusal-message-has-two-byte-identical). This task brings the two test files up to the amended ACs.

MEASURED: issues-upstream-shape-refusal.bun.test.ts AC-IS-2 is ALREADY RED on main — Expected 4 / Received 8 — because with no reachable gh the command now exits the transport code instead of the deleted refusal. mcp-issue-shape-message-ssot.test.ts AC-MS-3(b) goes red as of the MCP merge.

⛔ Root cause, recorded so the next slice budgets it: the spec's Scope table listed the three refusal SITES but never asked what ASSERTS those refusals today. A grep of the TEST tree for the refusal literals — the same scan AC-GR-8 runs over src — would have found both files before any code changed.
