---
id: TASK-1615
type: task
role: plan
title: "D1 lore assess is the binding seven-dimension milestone review; plan close requires a passing current review"
status: archived
priority: medium
phase: "D"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
links:
  - {id: TASK-1613, type: blocks}
---
Spec: spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D + corrected AC-LG-12; read them, they are the contract). ADR: adr-ai-decision-standard-four-checks-references-from-excellent. Delete-by-default; no compat shim. Reference: Kayenta automated canary analysis; Google engineering code review guide. lore assess takes <plan>... or --where and reviews each plan as its own row (Part A batch contract: per-row result, exit 0/1/3). Current state = fingerprint(plan version + every task id/version + main commit that last landed one of its tasks). Dimensions: correctness_vs_acs (reads attested task evidence), spec_conformance, regression, design_necessity (each technical choice names its external reference), snapshot_accuracy (reads cited-rule state), concurrency_safety, security; each {verdict pass|fail|na, reason, reference}. Plan close (checkPlanClose, checkpoint-registry.ts:1451-1571) then requires ONLY a passing current review (+ requires_uat when opted in): remove assessment freshness, the plan-level attestation floor, the cited-rule plan-close check, lore plan exempt-assessment-freshness and exempt-attestation. Resolve override-class decisions recorded with verdict 'milestone' (B4) from the review. Measured: 17 finished plans failed bulk close on exactly those three predicates (ATTESTATION_FLOOR_NOT_MET 24, ASSESSMENT_STALE 16, CITED_RULE_REFUTED 24).
