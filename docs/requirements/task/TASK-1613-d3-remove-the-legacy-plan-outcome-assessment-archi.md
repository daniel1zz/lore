---
id: TASK-1613
type: task
role: plan
title: "D3 remove the legacy plan-outcome assessment: archive old assessment docs, delete their schema, dead render code, dead config knobs and stale texts"
status: archived
priority: medium
phase: "D"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Left by D1 (spec-lean-governance-batch-verbs-judgment-only-at-milestones Part D; snapshot-only rule in adr-ai-decision-standard-four-checks-references-from-excellent): (1) core assessment.ts keeps facts/clip/scope-mismatch code only to parse legacy knowledge/assessment docs (373 docs, ~49 MB): the main agent archives those docs with lore bulk before this lands; delete the legacy schema and every reader of it; a read of an archived legacy doc shows its raw body. (2) assess-render.ts: keep only what lore status uses (formatStampVerdictLine) — move it next to status and delete the rest. (3) Dead config knobs ai.assess.max_plan_chars/max_spec_chars/max_task_chars and workflow.attestation.min_ratio's gating role: delete the unread knobs (lore migrate config-keys removes them from config files); keep min_ratio only if the dashboard panel still reads it, documented as display-only. (4) plan-promote reachability advisory (verifyReachability in gate-predicates.ts / gate-enforcer.ts) wording names the removed attestation floor: rewrite to the milestone review. (5) Tests that pin SPEC-143 AC-CT-9(d) and SPEC-141 AC-CP-4(c) were narrowed by D1; the main agent corrects those ACs. Add to milestone-review.test.ts a case that no code path parses the legacy assessment schema.
