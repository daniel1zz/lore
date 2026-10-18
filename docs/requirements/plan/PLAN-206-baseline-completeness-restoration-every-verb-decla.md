---
id: PLAN-206
type: plan
role: plan
title: "Baseline completeness restoration: every verb declared, 0 coverage gaps, no stale or draft leaf"
status: draft
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-157
phases:
  - {name: "P1-owners", description: "Classify and map the 91 unmapped census sites; per-branch coverage exit 0"}
  - {name: "P2-undeclared-verbs", description: "Leaf per undeclared verb, rules checked against code, sites mapped"}
  - {name: "P3-stale-and-draft", description: "Fix BOUT commands; review+approve drafts and new leaves"}
  - {name: "P4-non-cli-by-action", description: "MCP/HTTP/dashboard actions merged into same-action leaves"}
  - {name: "P5-remeasure", description: "Root coverage exit 0, verb diff empty, assess"}
---
# Plan: Baseline completeness restoration — every verb declared, 0 coverage gaps, no stale or draft leaf

Parent: SPEC-157. Owner request 2026-10-18: "按建议顺序补齐 baseline 缺口" (fill the baseline gaps in the suggested order), after a read-only audit found the baseline incomplete. Owner choice 2026-10-18 on non-CLI surfaces: merge by action (an MCP tool, HTTP route or dashboard write that performs the same action as a CLI verb joins that verb's leaf; only actions with no CLI counterpart get a new leaf).

## Measured starting state (2026-10-18, main 0cdfbcb5)
- `lore baseline coverage baseline-root --json`: complete=false; 114 leaves, 105 declared commands; 91 distinct unmapped sites (3141 leaf×site pairs); 87 distinct not_measured sites; 5 leaves ok.
- ~33 of the 91 sites are reached by 65-98 leaves (census over-approximation through app wiring: approve STALE_VERSION/override, evaluateDoneFloors, schema-probe, createAppUnscoped, store update STALE_VERSION). Each needs ONE owner leaf + rule; every other leaf maps it `non-business:owned-by <leaf> BR-n — reached only through the census over-approximation` (the convention already in use).
- Verbs declared by no leaf: `run` (register/show/end/occupancy/tasks/attest-input), `worktree check|sweep`, `red-first`, `plan exempt-attestation|exempt-assessment-freshness`, `phase list|status|checklist|track`, `rule propose|apply|changes`, `ac list|exempt`, `anchor list`, `scope list`, `audit` chain-head anchoring, `migrate` sub-modes other than v1/in-place upgrade.
- Leaf `baseline-write-an-outline-section` declares `outline set|rm|exempt`, retired in the CLI (only `outline list` remains).
- 11 draft leaves (demoted by rule edits of other sessions): CXSL, CXIN, CXRL, DSCK, ARCT, BRLC, BRAD, BOUT, SUBM, SNAT, SNSE.
- AC-BLS2-12 (specification + execution at 0 gaps) is red on main.

## Phases
- P1 Owners: classify each of the 91 sites (owner leaf + existing rule / new rule / infrastructure), apply, map the over-reach pairs by script. Exit: per-branch `lore baseline coverage <branch>` exit 0 for the 12 business branches with the 105 already-declared commands; AC-BLS2-12 green.
- P2 Undeclared verbs: a leaf (new or extended) per verb above, rules checked against code (file:line), sites mapped. Exit: every top-level verb and subverb of `lore --help` is declared by a leaf or recorded as non-business (with reason) in this plan; coverage still 0.
- P3 Stale and draft leaves: fix BOUT's declared commands; review + approve the 11 drafts and every leaf created in P1-P2.
- P4 Non-CLI surfaces, merged by action: MCP tools, HTTP routes and dashboard write actions mapped to the leaf of the same action (rule text states the entry points it governs); new leaves only for dashboard/HTTP-only actions.
- P5 Re-measure on main: `lore baseline coverage baseline-root` exit 0; verb-declaration diff empty; assessment.

## Method (as plan-baseline-fast-mode-migration-of-the-remaining-9-branches)
Excavators are read-only (one per branch group, in parallel) and return a data file: site → (owner leaf, BR-n | new rule draft | non-business reason), each with file:line. The orchestrator reads each data file, applies it from main one at a time, and re-runs coverage. Rules: business language only, ≤500 chars, 1-3 examples, confidence `observed` unless a live citing criterion proves it.

## Invariants
- I1 No source-code changes; a census or CLI defect found on the way is recorded as a task in the relevant defect backlog plan.
- I2 No repo .lore/ writes from tests; corpus writes only via lore commands from main.
- I3 Every agent-reported verdict is re-run by the orchestrator on main.
- I4 No rule is renumbered or recreated; existing rules are edited in place with `lore rule set`.
