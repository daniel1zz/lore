---
id: TASK-566
type: task
role: plan
title: "[Skill:implement] surface approved-to-draft demotion on every set path"
status: archived
priority: critical
phase: "Phase 2: Loud side effects"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-111
plan: PLAN-111
---
Estimate: M
Approach: (a) packages/lore/src/service/corpus-service.ts — `set()` already computes `isApprovedAutoResetToDraft` (lines ~1478-1481) as a silent internal side effect. Carry it out on the result (e.g. `auto_demoted_from_approved: true`) so every surface (CLI/MCP/HTTP) can render it. (b) packages/lore/src/adapters/cli/commands/set.ts — the AI-mutation branch already prints "(approved doc demoted to draft because content changed)" at lines ~361-363; the STANDARD patch path (lines ~477-491, --title/--content/--content-file) prints nothing. Print the SAME message text there, sourced from ONE shared constant so the two paths can never drift.
Source: spec DD-3; explorer fact sheet (corpus-service.ts 1478-1481, set.ts 361-363 and 477-491)
Dimensions: D-FUNC, D-UX
Scope-Alt: none
Covers: AC-CLOSURE-4

AC:
- Given an APPROVED doc, When `lore set <doc> --content-file <f>` runs (standard path), Then the demotion advisory is printed AND the doc's status is draft afterwards.
- Given a DRAFT doc edited the same way, Then no advisory is printed.
- Given an approved doc where only `--priority`/`--tags` change (no content/title), Then no demotion and no advisory (the rule is content-or-title only).
- Given the two code paths, Then both emit byte-identical advisory text (assert they resolve to the same exported constant — a duplicated string literal fails this AC).
- `bun run typecheck` exit 0.
