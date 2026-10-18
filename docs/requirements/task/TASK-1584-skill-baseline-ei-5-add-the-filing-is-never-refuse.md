---
id: TASK-1584
type: task
role: plan
title: "[Skill:baseline] EI-5 add the 'filing is never refused for the number of open reports' rule so AC-GI-9 cites it before its exemption lapses (2026-11-18)"
status: draft
priority: medium
phase: "Phase 1: rule and re-verification"
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-203
plan: PLAN-203
---
Estimate: S
Approach: EI-4 corrected AC-GI-9's oracle (comment lines no longer counted) on spec-the-defect-channel-reaches-no-machine-but-its-own-github; the correction needed a citation and no live rule states the no-cap behaviour (cap deleted in 9e9586dd), so AC-GI-9 holds a bounded exemption until 2026-11-18. Add the rule on the owning baseline leaf (likely baseline-report-a-defect or the filing leaf — find via lore rule find --text filing), then lore ac cite the AC to it and remove the exemption.
Source: EI-4 triage 2026-10-18
AC: AC-GI-9 cites a live rule; its exemption is removed; AC-GI-9 still verifies green.
