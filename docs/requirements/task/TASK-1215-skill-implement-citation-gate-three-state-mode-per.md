---
id: TASK-1215
type: task
role: plan
title: "[Skill:implement] Citation gate: three-state mode, per-branch arming, liveness in the write tx, feeding pack"
status: archived
priority: critical
phase: "Phase 3: Citation gate"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
links:
  - {id: TASK-1212, type: blocks}
---
Estimate: L
Approach: new checkpoint ac-cite: workflow.gates."ac-cite" {mode: off|report|enforce, armed_branches}; resolved default off without baseline docs else report; evaluated by the chokepoint on added/revised criteria only; liveness = SELECT lifecycle FROM rule_registry inside the spec write tx; spec branch = branch of the leaf most of its criteria cite; feeding pack gets its candidate rules from RuleReadService.find (one ranking: the spec's code anchors -> branch -> text; no second ranking implementation) and shows exemption headroom
Source: spec C4/D3-D6; ops review (two-state enabled defaults ON); perf review (tx index)
Covers: AC-BLS2-2, AC-BLS2-3
AC:
- Before editing: record expected-fail of AC-BLS2-2's and AC-BLS2-3's commands on THIS task
- both commands pass
- AC-BLS2-2's test file includes a latency case asserting p95 added latency <= 50 ms over 50 ac add calls on a 1,500-rule in-memory fixture
- Existing gate tests (checkpoint-registry, gate-enforcer) green
