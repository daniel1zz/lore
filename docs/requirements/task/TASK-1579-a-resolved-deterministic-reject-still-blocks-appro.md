---
id: TASK-1579
type: task
role: plan
title: "A resolved deterministic reject still blocks approve after a re-review approves the same version"
status: draft
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PLAN-196
plan: PLAN-196
---
Observed 2026-10-18 on adr-mapping-a-census-site-does-not-demote-a-baseline-leaf-an v1: first lore review rejected only on parent_contract (no parent); after lore link --type parent (which does not bump the version) a second review of the same version approved (0.80). lore approve then refused JUDGMENT_REJECTED (worst-decision-wins over both rows); only --override-judgment <reject id> got through. Expected: a judgment whose only blocking finding was a deterministic check that now passes should not outrank a later approving judgment of the same version, or link changes that fix parent_contract should bump the version so the stale judgment no longer applies. Judgments: 01M56QAF6PRHKWAQQJP8TY5GFR (reject), 01M56QBWAZ1A26QSWMPNR75N7Q (approve).
