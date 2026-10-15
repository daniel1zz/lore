---
id: TASK-1026
type: task
role: plan
title: "[Skill:implement] CLI entry resolves identity once and wraps the store; claimed author replaces the 'system' literal"
status: archived
priority: critical
phase: "P3 Write surfaces"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
links:
  - {id: TASK-1033, type: blocks}
  - {id: TASK-1038, type: blocks}
  - {id: TASK-1035, type: blocks}
  - {id: TASK-1037, type: blocks}
---
Estimate: L — every edit sits behind the one composition-root chokepoint (entry strip, identity resolution, decorator wrap, name source, end of the 'system' literal); splitting would leave a window where the decorator exists but nothing calls it
Approach: per spec D1, D3, D4, D7 — the CLI entry calls resolveInvocationIdentity on argv/env, strips the flag, verifies the run via RunService (unknown → null + one warning), and createApp wraps the store with withWriteContext; CorpusService writes the claimed name or null instead of "system"
Source: spec §Structure; code map: corpus-service.ts:1677,2800,3226 ('system' defaults), app.ts composition root
Dimensions: D-FUNC, D-CODE
Scope-Alt: none
Covers: AC-RID-5, AC-RID-8, AC-RID-6 (CLI half: one deprecation line per process), AC-RID-9 (the 'system' clause)

AC:
- Given `cd packages/lore && bun test tests/integration/cli/write-attribution-matrix.bun.test.ts`, `... write-unattested.bun.test.ts` and `... lore-actor-deprecation.bun.test.ts`, Then each passes.
- Given `grep -n '"system"' packages/lore/src/service/corpus-service.ts`, Then no author default remains.
- Given the CLI integration scope (`cd packages/lore && bun test tests/integration/cli`), Then no previously green test turns red (risk R5).
- Integration: From a fresh corpus, performing `lore --harness-run <registered R> create knowledge ...`, Then `lore log <slug>` shows R for that version.
