---
id: TASK-181
type: task
role: plan
title: "[Skill:implement] T6 CLAUDE.md marker-section migration + user_once semantics"
status: archived
priority: medium
phase: "Phase 3: Peripherals"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-040
plan: PLAN-040
links:
  - {id: TASK-175, type: blocks}
---
Estimate: M
Approach: setup-project-flow.ts CLAUDE.md handling migrates from backup-then-overwrite to marker-section rewrite: managed content lives between `# ─── lore governance (managed) ───` / `# ─── end lore governance ───` markers. Three legacy on-disk forms each golden-fixtured: (a) no CLAUDE.md → write full file with markers; (b) old full-file stub (byte-matches a known template generation, detected via template registry or ledger sha) → wrap: preserve nothing (it was ours), emit marker form; (c) user-authored/modified file → append marker block at end, touch NOTHING outside markers, mandatory backup first (R3). user_once entries (config template, lore.tree.yaml) asserted never rewritten on converge.
Source: SPEC-076 §C1 D7; SPEC-060 D3 marker-append precedent (.gitignore)
Dimensions: D-FUNC, D-CODE
Scope-Alt: form-(b) detection may fall back to treating unknown as form (c) — safe direction, extra marker block instead of content loss
Covers: AC-076-4

AC:
- Given each of the three legacy forms (golden fixtures), When converge runs, Then bytes outside the marker pair are byte-identical to pre-converge and the section between markers equals the new template
- Given a user_once file present, When converge runs twice, Then its bytes and mtime are unchanged both times
- Given marker rewrite failure (fs error injected), Then original file is untouched and the error is loud (R3 contingency)
- Integration: cd packages/lore && bun test tests/integration/setup-user-once-marker.bun.test.ts green (authored in-task red-then-green)
