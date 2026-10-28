---
id: TASK-2003
type: task
role: plan
title: "Close plan 418: verify, apply rule changes, anchors, fresh-consumer check"
status: approved
priority: high
phase: "P5 Close"
created: 2026-10-26
updated: 2026-10-27
tags: []
parent: PLAN-253
plan: PLAN-253
links:
  - {id: TASK-2090, type: blocks}
  - {id: TASK-2083, type: blocks}
  - {id: TASK-2100, type: blocks}
  - {id: TASK-2098, type: blocks}
  - {id: TASK-1954, type: blocks}
  - {id: TASK-1951, type: blocks}
  - {id: TASK-1929, type: blocks}
  - {id: TASK-1930, type: blocks}
---
Covers: AC-RV-12 (human, recorded with lore uat record); AC-RV-1..11 are attested here by lore verify
Steps: bun run build on main; lore verify plan-per-call-run-identity-verified-by-process-ancestry-418; lore rule apply spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and (BR-1424 live; BR-1055, BR-1218, BR-1351 rewritten); lore anchor add on the spec for run-identity.ts#prefixRunExport, run-identity-node.ts#verifyRunAncestry and call-scope.ts; from a fresh consumer install (temporary HOME, lore setup), one agent session writes through './dist/lore' path form and inside a for loop, both stamped with the session's run. Then lore assess.
Also: land integration/run-identity-418 with one lore integrate (P2+P3 unit) before verify. AC-RV-12 is human mode: in a live session with user rules allow Bash(lore get:*) and deny Bash(rm:*), confirm a prefixed lore get runs without a prompt and a prefixed rm is denied; record it with lore uat record on this plan. If the allow rule cannot match the export line, stop and report to the user (no hook allow decision).
