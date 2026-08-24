---
id: TASK-810
type: task
role: plan
title: "[Skill:test] issues-upstream-shape-refusal — four CLI-surface describes against a throwaway corpus, RED first"
status: draft
priority: high
phase: "P1: Red"
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-140
plan: PLAN-140
---
Author the test file named by AC-IS-1..AC-IS-4's --command. Four describes, titled EXACTLY 'AC-IS-1 retired-shape upstream refuses the upstream read', 'AC-IS-2 green control: GitHub-shape upstream still refuses', 'AC-IS-3 --local stays exit 0 under both shapes', 'AC-IS-4 both verbs source the retired refusal from one classifier' — the AC statements name these titles as the traceability anchor, so they must match verbatim. Every probe builds its own throwaway corpus (mkdtemp + lore init, cwd inside it) and NEVER touches this repo's .lore/. Run it, and record the red with 'lore evidence --result expected-fail' AT THE MOMENT it is red. Do not implement anything.
