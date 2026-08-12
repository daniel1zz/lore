---
id: TASK-692
type: task
role: plan
title: "The pure corpus-provenance resolver: four outcomes decided from supplied facts, zero IO"
status: draft
priority: medium
phase: "resolver"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-128
plan: PLAN-128
---
Lands D2 and the decision half of D1. New browser-safe module in @lore/core exporting CorpusProvenance ('own' | 'git_common_dir' | 'undetermined') and ResolvedCorpus, plus the pure resolver taking {cwd, probeExists, gitFacts}. Mirror resolveVerifyExecutionRoot (verify-execution-root.ts) exactly: facts in as data -- no fs, no git, no process.cwd, no process.exit. AC-CP-1 pins all four outcome rows to input shapes and requires the purity census to walk THIS module's own transitive import graph, not the test file's imports, which prove nothing about the module.
