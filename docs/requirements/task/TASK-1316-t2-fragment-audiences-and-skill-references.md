---
id: TASK-1316
type: task
role: plan
title: "T2 fragment audiences and skill references"
status: archived
priority: medium
phase: "W2"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-183
plan: PLAN-183
---
Fragment audiences and skill references. Governing spec: spec-two-helper-agent-types-lore-reader-and-lore-implementer (scope items 3, 4).

- Every subagent:lore-explorer / subagent:lore-reviewer audience becomes subagent:lore-reader; every subagent:tester is dropped (assets/context and .lore/context).
- Every dispatch or mention of lore-explorer / lore-reviewer / tester as an agent type under assets/skills becomes lore-reader or lore-implementer, with the role named in the dispatch bundle text.
- Every subagent_type="lore-implementer" example under assets/skills carries isolation="worktree" on the same line (fixes lore-test/SKILL.md and lore-test/references/six-dim-coverage.md).
- Regenerate the assets manifest; refresh project rules files if the render changes.
