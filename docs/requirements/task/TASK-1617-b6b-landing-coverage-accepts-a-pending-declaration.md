---
id: TASK-1617
type: task
role: plan
title: "B6b landing coverage accepts a pending declaration for a command the branch adds (approve-vs-land deadlock)"
status: archived
priority: medium
phase: "B"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
links:
  - {id: TASK-1616, type: blocks}
---
Deadlock found landing D2: check:baseline-coverage:changed refused 'undeclared checks stats' because coverage measures only APPROVED leaf declarations; lore baseline map added it as a pending revision; lore approve then refused: 'declares checks stats, which main's tree does not have'. So a new command can never land. Fix (consistent with 'a spec carries its rule changes; the baseline takes them when the spec lands'): in --changed mode, a command the branch ADDS counts as declared when some leaf declares it in its approved state OR its pending revision; after landing, the approve succeeds because the command is on main. Full plan-close coverage keeps measuring approved declarations only, so a pending declaration that is never approved is still caught at the milestone. Add Report, per baseline leaf, the census sites whose code declares one of its rules (file:line) and the
  sites that declare none; exit 1 only when a runnable command no leaf declares (root) (baseline
  coverage)

USAGE `baseline coverage [OPTIONS] <TARGET>`

ARGUMENTS

  `TARGET`    Baseline leaf or branch|root ID or slug

OPTIONS

           `--json`    Output result as JSON
  `--commands-only`    Check only for undeclared commands; never run the site census (the integrate
                       floor's mode) if the script needs it. Test in floor-steps.test.ts: added command + pending declaration → :changed passes; added command + no declaration → fails; plan-close run with only a pending declaration → fails.
