---
id: TASK-070
type: task
role: plan
title: "T6 verify + dogfood: full oracles, structured-AC conversion, docs sync"
status: draft
priority: critical
phase: verify-dogfood
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-018
plan: PLAN-018
---
Objective: whole-feature verification + self-hosting closure.
Spec: SPEC-038 §8-§10. ACs covered: AC-ACODE-8 (final grep), AC-ACODE-10, AC-ACODE-11 + dogfood conversion.
Work:
1. Full oracle run: bun run typecheck; bun run test (BOTH runners, full suites); record each as evidence on this task.
2. Dogfood: convert SPEC-038's own 11 prose ACs to structured extra.acceptance_criteria via the NEW lore ac add verbs (the first real-world use). Then lore ac list must show all 11.
3. Update module CLAUDE.md files touched by T1-T5 (core, service, ai, adapters/cli, adapters/mcp) per their conventions; root CLAUDE.md spec index gains SPEC-038 line.
4. lore export-docs sync; verify export-index integrity; git add + conventional commits (feat/test/docs split as the repo history does).
Oracle: bun run test full + lore ac list output. Depends: T1-T5 all merged.
File anchors: CLAUDE.md files, docs/requirements/spec/ exports. Serial-only (runs after all merges; touches shared files).
