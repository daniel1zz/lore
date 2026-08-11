---
id: TASK-329
type: task
role: plan
title: "Print the approved-to-draft demotion and its claim-blocking blast radius when lore ac add or ac set causes one"
status: archived
priority: medium
phase: "visibility"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-078
plan: PLAN-078
---
`commands/ac.ts:50` documents the `approved` -> `draft` demotion in a CODE COMMENT only; runtime output says nothing. The demotion hard-blocks EVERY descendant `claim`, so tightening one AC silently freezes a whole plan's dispatch.

Evidence it is not theoretical: authoring the sibling spec `spec-oracle-executability-...` in this session required encoding an explicit sequencing workaround around this exact behaviour. ⛔ Needing a workaround IS the signal.

Print the demotion AND the count of descendant docs whose claims it now blocks. ⛔ AC-GV-4's second half is load-bearing: a write that causes NO demotion must print NEITHER. An unconditional notice would satisfy a naive assertion while training readers to ignore it. The demotion itself is correct lifecycle behaviour — do not change it.
