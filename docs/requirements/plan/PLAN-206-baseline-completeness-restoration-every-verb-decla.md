---
id: PLAN-206
type: plan
role: plan
title: "Baseline completeness restoration: every verb declared, 0 coverage gaps, no stale or draft leaf"
status: approved
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
- About 33 of the 91 sites were reached by 65-98 leaves (census over-approximation through app wiring). Each needs one owner leaf and rule; every other leaf maps it `non-business:owned-by <leaf> BR-n — <reason>`.
- 18 CLI verbs were declared by no leaf: reopen, phase list/status/checklist/track, plan exempt-attestation/exempt-assessment-freshness, ac list/exempt, anchor list, scope list, rule propose/apply/changes, red-first, run, worktree check/sweep.
- 11 draft leaves (demoted by earlier rule edits of other sessions): CXSL, CXIN, CXRL, DSCK, ARCT, BRLC, BRAD, BOUT, SUBM, SNAT, SNSE.
- AC-BLS2-12 (specification + execution at 0 gaps) was red on main.

## Dependency
P1 was blocked by plan-site-map-maintenance-keeps-approval-owned-by-is-checked (owner choice 2026-10-18: change the mechanism before mapping; decision adr-mapping-a-census-site-does-not-demote-a-baseline-leaf-an). P4 inventory: knowledge-non-cli-entry-points-mapped-to-baseline-leaves-by.

## Phases
- P1 Owners: classify each unmapped site (owner leaf + existing rule / new rule / infrastructure), apply, map the over-reach pairs. Exit: per-branch coverage exit 0; AC-BLS2-12 green.
- P2 Undeclared verbs: a leaf (new or extended) per verb, rules checked against code (file:line), sites mapped. Exit: every verb and subverb of lore --help is declared by a leaf or recorded here as out-of-branch with a reason; coverage still 0.
- P3 Stale and draft leaves: check BOUT's declared commands; approve the 11 drafts and every leaf created in P1-P2.
- P4 Non-CLI surfaces, merged by action: entry-point behaviour recorded on the leaf of the same action; new leaves only for actions with no CLI counterpart.
- P5 Re-measure on main: root coverage exit 0; verb-declaration diff; assessment.

## Method
Read-only excavators per batch return site decisions with file:line; the orchestrator applies them from main with lore commands only, and re-measures coverage after each round. No source-code changes in this plan (the mechanism change landed in its own plan).

## Invariants
- I1 No source-code changes here; defects found on the way are recorded as tasks in the defect backlog plans.
- I2 No repo .lore/ writes from tests; corpus writes only via lore commands from main.
- I3 Every agent-reported verdict is re-checked by the orchestrator on main.
- I4 No rule is renumbered or recreated; existing rules are edited in place.

## Result (2026-10-18, measured on main d459f853 with dist/lore built at that commit)
- P1/P2/P4 coverage: `lore baseline coverage baseline-root` exit 0, complete=true, 123 leaves ok, 0 gaps, 0 unaccounted not_measured. One site added by a later merge (StoreInterface#readAutonomyThresholds) was mapped at close; the AC-BLS2-12 checks (specification + execution) then pass with the built binary.
- P2 verb diff (lore --help, 124 verbs and subverbs): every verb is declared by a leaf except `decide` and `stash`, recorded here as out-of-branch per the P2 exit clause: they are the autonomy plan's work in progress (plan-autonomy-phase-1-decision-function-human-channel-lore) and their census sites are mapped `out-of-branch:autonomy`. `run reap` is a subaction of the declared `run` and is mapped the same way.
- P3: BOUT needed no change — its declared `outline set|rm|exempt` record that those retired writes are refused (BR-985); the audit's first reading was wrong. All 11 originally-draft leaves (CXSL, CXIN, CXRL, DSCK, ARCT, BRLC, BRAD, BOUT, SUBM, SNAT, SNSE) and all 9 leaves created here are approved; 46 baseline nodes approved in total. 3 architecture nodes remain draft; they were edited by other sessions and are outside this plan.
- Mechanism first: plan-site-map-maintenance-keeps-approval-owned-by-is-checked landed (merge 2308a0e2; BR-654/658/660 modified via rule apply). Site-only maps no longer demote; owned-by exclusions are checked — 16 stale or malformed legacy entries surfaced and were repaired.
- Rules: 59 new rules, BR-1178..BR-1236 (contiguous, all allocated by this session; they include the P4 entry-point rules BR-1222..BR-1231, and BR-1206, which was reworded after it was created). 10 existing rules reworded in place (BR-32, BR-209, BR-252, BR-256, BR-897, BR-971, BR-1029, BR-1032, BR-1062, BR-1083) plus 3 via the mechanism spec (BR-654, BR-658, BR-660). 3 moved (BR-1050, BR-1054 to REOP; BR-1079 to WTRM). 9 new leaves (REOP, PHCL, PHTR, RCHG, RAPL, RDFT, WTRM, JDGR, EVPN). About 7,600 site mappings; 117 legacy BR-283/BR-285 attributions corrected; held-below tables completed on 16 leaves.
- Owner decisions recorded: BR-1023 stays on Enter a seat (Session boundary widened); BR-370 is a defect (task-lore-seat-accepts-any-document-as-target-it-must-refuse-a); BR-1032 reworded (no environment source); the write-a-business-rule escalation was already resolved in its content; P4 attribution gap filed (task-web-api-approve-and-reject-record-no-reviewer-and-web), other entry-point differences recorded as observed rules.
- Defects filed (not fixed here): stale deterministic reject blocks approve (task-a-resolved-deterministic-reject-still-blocks-approve-after); ac exempt help vs code (task-lore-ac-exempt-help-says-the-criterion-must-be-uncited-but); duplicate checklist ids (task-a-phase-checklist-accepts-two-items-with-the-same-id-drop); 39 registry-leaf mismatches BR-1114..~1152 (task-39-rule-ids-are-registered-to-session-leaves-that-no).

## Open items
- Re-verify AC-BLS2-12 in its declared source-run form once main has no unresolved merge: at close another session's merge left a conflict in packages/lore/src/generated/assets-manifest.ts, so only the binary form was run.
- Leaves for `decide`, `stash` and `run reap` when the autonomy plan lands.
- Coverage is a moving target: every merge that adds a census site reopens a gap, and nothing refuses such a merge — NOT ENFORCED.
- The census measures CLI entry points only; MCP/HTTP/dashboard behaviour is described by rules (P4) but not measured.
