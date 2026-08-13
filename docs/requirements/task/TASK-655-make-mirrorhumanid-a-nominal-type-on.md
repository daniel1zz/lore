---
id: TASK-655
type: task
role: plan
title: "Make MirrorHumanId a nominal type on exportIndexMappingSchema.human_id with one sanctioned cast at the parse boundary, and guard that escape with a cast-site rule"
status: archived
priority: high
phase: "brand"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-125
plan: PLAN-125
---
D3/D4 of the governing spec. BLOCKED BY the reconcile phase — landing the brand while :743 still returns formatDocDisplayId's plain string makes bun run typecheck red by construction. Declare a branded MirrorHumanId in packages/core/src/ordinal.ts (type-only, no runtime import: the default @lore/core barrel must stay browser-safe or the dashboard SPA breaks at module load) and make formatMirrorHumanId return it. exportIndexMappingSchema.human_id (packages/core/src/schemas.ts:1132) carries the brand, with the ONE sanctioned cast at the JSON parse boundary in that same file. Add a cast-escape rule to scripts/check-ordinal-write-sites.mjs: an 'as MirrorHumanId' or laundering 'as unknown as MirrorHumanId' outside packages/core/src/schemas.ts makes main() return EXACTLY 3 naming rule and file:line, the identical cast inside schemas.ts returns 0, and the real tree returns 0 — extend the existing injected-fixture-tree cases in scripts/tests/check-ordinal-write-sites.test.ts, and keep .d.mts in sync. Add the AC-MIS-6 negative control asserting a plain-string assignment is TS2322 at exit exactly 1 (measured: brand violations are TS2322 exit 1, NOT exit 2). Budget the tree-wide back-catalogue sweep in this slice.
