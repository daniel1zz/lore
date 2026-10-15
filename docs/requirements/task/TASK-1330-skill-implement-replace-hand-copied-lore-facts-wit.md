---
id: TASK-1330
type: task
role: plan
title: "[Skill:implement] Replace hand-copied lore facts with variables and constants"
status: archived
priority: medium
phase: "Phase 2: Shipped assets and literal lint"
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PLAN-185
plan: PLAN-185
links:
  - {id: TASK-1327, type: blocks}
---
Estimate: M
Approach: add literalPatterns to capture_tail_chars (/\b4000[- ]char/ and equivalents) and the agent-name entries where a pattern is unambiguous; replace hand-copied values with {{lore:…}} in assets/context/*.md and assets/skills/** prose, and with CAPTURE_TAIL_CHARS in the 9 source files of the AC-CV-6 scan set; regenerate the manifest with the script.
Source: spec D8; AC-CV-6 scan set
Covers: AC-CV-6

Also (AC-CF-6 oracle amendment, spec Overview): packages/lore/tests/e2e/context-fragments-compiled.bun.test.ts and the refresh-idempotence / refresh-cas tests compare rules-file bodies against registry-expanded fragment source (shippedStaticMainFragments() expands via expandFragments) so they stay green once assets/context fragments carry {{lore:}}. Agent-name literalPatterns do not scan assets/hooks/*.mjs.

AC:
- AC-CV-6 command exit 0; `cd packages/lore && bun test tests/e2e/context-fragments-compiled.bun.test.ts` exit 0; and it reports the hit when one replaced literal is restored (shown by the test's planted-literal case).
- `bun packages/lore/src/index.ts context refresh` in a mkdtemp repo renders the same visible numbers as before; no "{{lore:" in output.
