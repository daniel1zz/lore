---
id: TASK-1593
type: task
role: plan
title: "[Skill:baseline] TG-43 add the rule TG-41's 14 AC corrections need, then replace their citation exemptions (expire 2026-11-17)"
status: archived
priority: medium
phase: "Phase 3b: one runner"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-201
plan: PLAN-201
---
Estimate: S
Approach: TG-41 corrected 18 AC commands to `bun run test:file` (16 had collected no tests: exit 1 'No test files found'; AC-060-8 and AC-EH-1 were false greens running 2 of 3 files). The citation gate required a cite and no baseline rule states how a criterion's test files are run, so ~14 ACs (AC-GI-4, GI-12, 060-8, GR-11, CP-5, 069-8/9/10/11/12/14, EH-1, FR-11 — re-list to confirm) hold exemptions until 2026-11-17. Add a rule on the owning leaf (e.g. 'a criterion's declared command runs every named test file and fails when a named file collects no test') — find the leaf with lore rule find --text 'criterion command'; then lore ac cite each AC and remove its exemption. If TG-42 removes the Node/Bun split first, the rule text still holds.
Source: TG-41 report 2026-10-18
AC: every TG-41-corrected AC cites a live rule; none holds an exemption; each still verifies green.
