---
id: TASK-1315
type: task
role: plan
title: "T1 agent definitions, dispatch hooks, setup retirement test"
status: archived
priority: medium
phase: "W1"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-183
plan: PLAN-183
---
Agent definitions, dispatch hooks, and the setup retirement test. Governing spec: spec-two-helper-agent-types-lore-reader-and-lore-implementer (scope items 1, 2, 5 for these files, 6).

- Add assets/agents/lore-reader.md (frontmatter: name lore-reader, read-only description covering both locate-facts and review-a-change entry points, disallowedTools Write/Edit/NotebookEdit under the disallowedTools key, omitClaudeMd true; no model pinned unless measured necessary — model is a dispatch parameter). Body: merge the explore discipline of lore-explorer and the review procedure of lore-reviewer; for review, point at assets/skills/lore-review references instead of restating them. State in the body that Bash writes are NOT mechanically prevented.
- Delete assets/agents/lore-explorer.md and assets/agents/lore-reviewer.md.
- lore-implementer.md: drop "route to tester subagent"; test-only work is this type with the lore-test skill.
- pre-dispatch-isolation-gate.mjs: WRITING_AGENTS = {lore-implementer}; comments and denial text name lore-reader as the read-only alternative.
- pre-no-general-agent-gate.mjs: roster lists lore-reader and lore-implementer only.
- Tests pinning the shipped agent list or these hooks follow the new names; new packages/lore/tests/integration/setup-retired-agent-types.bun.test.ts proves BR-975 for the two retired files (both ends of the diff plus an untracked control file).
- Regenerate the assets manifest.
