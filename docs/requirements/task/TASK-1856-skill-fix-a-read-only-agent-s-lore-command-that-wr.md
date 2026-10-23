---
id: TASK-1856
type: task
role: plan
title: "[Skill:fix] A read-only agent's lore command that writes the project corpus is refused at the service layer"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Estimate: M
Problem (reported by a lore-reader triage agent, 2026-10-19): while reproducing an issue in a throwaway corpus, a failed `cd` left a `lore set` / `lore approve` / `lore review` chain running in the repository directory, i.e. against the live corpus. Every command failed only because the throwaway doc slugs did not exist ("Document not found"). Nothing refuses a corpus-writing lore command from a read-only agent: lore-reader's read-only status is enforced only for Write/Edit/NotebookEdit tools, not for corpus writes through Bash.
Approach: a corpus write records the acting run (agent type known to the harness run registry); the service-layer write gate refuses a corpus write whose run's agent type is declared read-only (lore-reader, Explore, Plan, researcher...) with exit 4 naming the rule — at the service layer, so CLI/MCP/HTTP are all covered. A write to a corpus outside the repository (a mktemp throwaway) stays allowed for such runs, because reproduction needs it.
AC: integration test: a run registered with agent type lore-reader running `lore set <doc> --title x` against the repo-style corpus is refused with exit 4 and the rule name; the same run writing a mktemp corpus succeeds; a lore-implementer run writing the repo-style corpus succeeds. Make the first red once.
