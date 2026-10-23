---
id: TASK-1604
type: task
role: plan
title: "D5 snapshot accuracy fails only on contradicted rules; stale evidence is re-verified once per batch before the review"
status: archived
priority: medium
phase: "D"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Measured on 2026-10-23: a re-review of 20 finished plans with D4's batch inputs still failed snapshot_accuracy on 14 of them, because 83 cited rules read "stale".

In packages/lore/src/service/rule-state-service.ts, "stale" means that a citing spec's code anchors changed after the citing AC's last attested passing run (BR-984: changed anchors). It does not mean that the document and the code disagree. "contradicted" is the state that does: a failing run of the citing AC. The milestone review prompt and milestone-review-inputs.ts treat "stale" as a disagreement.

Fix:
1. snapshot_accuracy fails only on a cited rule whose state is "contradicted". "stale", "unknown" and "unverified" are n/a, each with its reason.
2. Before judging, `lore assess` refreshes stale evidence once per batch. It collects the citing ACs of every stale cited rule across all plans in the batch, deduplicated, and runs them through the existing trusted runner (the `lore verify` path, attested). Then it recomputes rule state. A rule that becomes "contradicted" fails the dimension, and one that becomes "verified" passes it.
3. The review prompt's wording for snapshot_accuracy follows these definitions.

Reference: Bazel's action cache. A cache entry whose inputs changed is re-executed, and is never treated as a wrong result.

Tests: a stale rule whose citing AC still passes becomes verified and the dimension passes. A stale rule whose citing AC now fails becomes contradicted and the dimension fails. Two plans citing the same stale rule cause exactly one run of its AC per batch.
