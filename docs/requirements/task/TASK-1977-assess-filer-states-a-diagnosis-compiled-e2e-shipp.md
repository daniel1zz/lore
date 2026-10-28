---
id: TASK-1977
type: task
role: plan
title: "Assess filer states a diagnosis; compiled e2e; shipped guidance"
status: draft
priority: high
phase: "P4 Callers and distribution"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-254
plan: PLAN-254
links:
  - {id: TASK-2082, type: blocks}
---
Covers: AC-MI-5
Approach: assess-file-issues passes the literal 'symptomOnly: true' (falsifier). Shipped guidance (corpus-workflow-4-close.md, lore-plan mode-resume.md) tells an agent to file with --mechanism and --end-state when traced, else --symptom-only; then lore context refresh so .claude/rules mirrors it (bun run check:memory-files). The e2e runs dist/lore against a throwaway corpus and a fake GitHub endpoint, never the real repository.
