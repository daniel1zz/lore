---
id: TASK-567
type: task
role: plan
title: "T1: assessmentFreshness predicate on plan-close + lore assess staleness advisory"
status: archived
priority: medium
phase: "P1-impl"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-110
plan: PLAN-110
---
Implement SPEC-106 verbatim. The plan-close checkpoint already exists (SPEC-054 UAT + SPEC-069 attestation floor) and is armed — add assessmentFreshness as an ADDITIONAL predicate in the same shape, never a new checkpoint. Staleness = the plan's newest linked assessment doc timestamp is OLDER than the newest evidence/done AUDIT row among the plan's tasks (D2: audit rows, NOT doc updated_at, so anchor adds and link writes never trip it). Computed read-side, never stored (D5). Vacuous pass when the plan has no assessment or no task activity. Exemption mirrors attestation_exempt exactly: extra.assessment_freshness_exempt true AND a non-empty reason; a bare flag is NOT exempt (D4). lore assess itself WARNS loudly and still writes (D3 — never gate the remedy on the condition it cures). Feeding pack must name the exact re-run command. Covers AC-FRESH-1..5, tests red-first.
