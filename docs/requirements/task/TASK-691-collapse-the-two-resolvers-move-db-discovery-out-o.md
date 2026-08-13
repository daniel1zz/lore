---
id: TASK-691
type: task
role: plan
title: "Collapse the two resolvers, move DB discovery out of utils.ts, and kill its three false header claims"
status: archived
priority: medium
phase: "resolver"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-128
plan: PLAN-128
---
Lands D3 and D6. findLoreDbPath and findLoreDbPathQuiet become <=3-line wrappers over ONE shared resolver returning ResolvedCorpus | undefined; the six existing callers stay byte-identical. DB discovery relocates out of the 1175-line utils.ts, and the three measured-false header claims die in the SAME change -- the DB-discovery-lives-in-loader line is the one that misdirected the original defect report's file anchor. AC-CP-2 pins every half to an AST/checker mechanism because a name grep is defeated by an intermediate binding. BLOCKED on the pure-resolver task landing.
