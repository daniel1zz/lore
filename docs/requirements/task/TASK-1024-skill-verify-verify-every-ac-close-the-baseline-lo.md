---
id: TASK-1024
type: task
role: plan
title: "[Skill:verify] verify every AC, close the baseline loop, measure day-0 attribution"
status: archived
priority: critical
phase: "P6 Verification and close"
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PLAN-162
plan: PLAN-162
---
Estimate: M
Source: plan Exit criteria
Covers: AC-RID-1..18

Steps:
1. On main after the last merge: `bun run build`, `bun run typecheck`, `bun run test:vitest`, `bun run test:bun` (unscoped, cache bypassed).
2. `lore verify <plan>` — every AC attested pass.
3. `lore rule set` BR-1027..BR-1045 to established where their citing AC now passes; confirm BR-125 and BR-135 were deprecated by the claim task and the purge task (leaf 'Superseded on landing').
4. `lore anchor add` the spec to its landed files; `lore status --check-drift` exit 0.
5. Update the maintainer's user fragments user-04 / user-17 and run `lore context refresh --scope user`.
6. Record `lore status --json` harness_run_attribution as the day-0 baseline in the handoff.

AC:
- Given step 2, When `lore verify plan-run-identity-slice-1-harness-attested-runs`, Then 18/18 AC attested pass.
- Given step 4, When `lore status --check-drift`, Then exit 0.
- Given `lore rule show BR-1040` and `lore rule show BR-125`, Then BR-1040 is established and BR-125 deprecated; same for BR-1045 / BR-135.
