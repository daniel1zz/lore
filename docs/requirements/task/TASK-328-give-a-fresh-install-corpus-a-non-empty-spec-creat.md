---
id: TASK-328
type: task
role: plan
title: "Give a fresh-install corpus a non-empty spec-create rule slice, proven with this repo's corpus as a live control"
status: archived
priority: medium
phase: "distribution"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-078
plan: PLAN-078
---
`corpus-service.ts:1110` states its own posture: a missing rule-doc lookup *"leaves ruleSource/ruleMarkdown absent — the pack degrades to [source: unknown]"*. The lookup is `findFeedingSkill(SPEC_CREATE_FEEDING_SCOPE)`, a CORPUS read. A project that just ran `lore init` has an empty corpus, so it always misses and the whole IoC design (deny CARRIES the feeding pack) degrades to a bare deny. The gate ships in the binary; the rules that make its denial actionable do not.

`assets/governance/` already ships three docs, so a distribution surface exists. Either seed the rule doc from `assets/` at `lore init`, or compile a fallback slice into the binary. ⛔ Per the repo's distribution-first rule, the fix must land on a surface that SHIPS.

⛔ THE PROBE MUST CONSTRUCT BOTH ENDS: a `mkdtemp` + `lore init` corpus AND this repo's populated corpus as a live control, in the same run. A single-ended probe passes vacuously (`knowledge-retro-a-fresh-install-probe-vacuously-passes`).
⛔ NEVER write to this repo's own `.lore/`.
