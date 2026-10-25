---
id: TASK-1828
type: task
role: plan
title: "[Skill:implement] BIND-P1 one resolver for prose and spec code references, one reverse index, lore refs"
status: archived
priority: medium
phase: "P1"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-231
plan: PLAN-231
links:
  - {id: TASK-1827, type: blocks}
---
Implements spec-prose-about-code-is-bound-to-what-it-describes-one D1 and D2 (plan plan-bind-prose-to-code-resolver-and-reverse-index-edit-time phase P1). Read the spec and plan first.

Key code: packages/core/src/code-anchors.ts (computeDrift :369-380, :496-590; scanExportedSymbols :285-307), packages/lore/src/service/claude-md-admission.ts (checkReferenceExistence :351-390, drops #Symbol at :368-370, called :863), packages/core/src/context-fragments.ts (fragment schema), DriftCheckService, `lore rule find --file` (rule-index-queries.ts:211-217) as the closest existing reverse lookup.

Done means: one core resolver used by both spec code anchors and memory-file/fragment references (paths, path#Symbol, `bun run <script>` and bare backticked existing script names); deterministic findings for missing path/symbol/script on `lore status --check-claude-md` and check:memory-files; one core reverse index over spec/knowledge code_anchors plus memory-file and fragment references; `lore refs <path> [--json]` CLI verb (and MCP parity if the CLI/MCP parity rules require it — check). Write AC-BIND-1/2/3 oracles red first, then green; record via `lore verify plan-bind-prose-to-code-resolver-and-reverse-index-edit-time` after landing is the main agent's job — you record `lore evidence --capture` for each AC command and tsc.

This repo's own memory files and fragments must pass the new check after your change: fix any reference in CLAUDE.md files / .lore/context/ that the new resolver reports (they are anchored).
