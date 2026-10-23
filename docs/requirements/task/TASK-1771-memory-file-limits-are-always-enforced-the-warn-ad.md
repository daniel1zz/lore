---
id: TASK-1771
type: task
role: plan
title: "Memory-file limits are always enforced; the warn adoption mode is removed by a one-time upgrade"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Decision (user, 2026-10-19): end-state the memory-file admission adoption mode. Source: review of baseline-hygiene (reject 0.74, design_necessity class d): a project that never chose a mode gets `warn`, which downgrades every deterministic memory-file finding (packages/core/src/config.ts:2223-2241; runMemoryFileChecks applies adoption). The reason recorded in the governing spec (decisions D3/D4 of spec-claude-md-root-section-structure-check-and-adoption-mode) is transitional: projects upgrading the binary should not fail their first push; new setups already write enforce when clean.

End state: memory-file limits are always enforced; there is no warn mode and no default-from-absence. Existing projects are brought to compliance once by an explicit, idempotent upgrade (a `lore migrate` action, preview by default, BR-801 pattern) that either rewrites what can be rewritten mechanically or lists what a person must fix, and refuses nothing silently. A config that still sets the adoption mode is refused by every command naming the migrate action (BR-1306 pattern), never ignored. Restate/retire the hygiene and context rules that describe warn; update the spec via a new linked spec or a rule change set, not by editing the locked spec.

AC: red-first — (a) a project with a memory file over a limit and no adoption mode configured fails the check (exit 4) where today it warns; (b) the migrate action previews then applies, and a second apply changes nothing; (c) a config still naming the adoption mode is refused naming the migrate action. Falsifier: today's warn default.
