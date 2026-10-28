---
id: TASK-2038
type: task
role: plan
title: "Q3 a failing re-review files every uncovered dimension; re-review once per closed cover"
status: archived
priority: medium
phase: "Q"
created: 2026-10-24
updated: 2026-10-26
tags: []
parent: PLAN-269
plan: PLAN-269
---
Resolves #397.

Live: plan-defect-clusters-round-1 re-reviewed after its snapshot_accuracy cover #361 was closed; the re-review (knowledge-milestone-review-defect-clusters-round-1-6) still failed snapshot_accuracy with the same fingerprint (3a08103683f2...). The batch filed #395 for spec_conformance only, nothing for snapshot_accuracy, and close was refused. The plan stays needs-review, so each batch pays for another review and is refused again.

1. Reproduce from the live records (read-only sqlite on the shared checkout's .lore/lore.db; GitHub issue states via gh) and find exactly why filing skipped the snapshot_accuracy finding (suspects: dedupe or "already filed" logic matching the closed issue's milestone_findings record instead of OPEN issues; the stored causes for that dimension).
2. Fix: a failing review files (or links an OPEN issue for) every uncovered failed dimension; a fingerprint equal to a closed issue's opens a new issue.
3. Bound the loop: a plan is re-reviewed for a closed cover at most once per (plan fingerprint, set of closed covering issues); after that, a filing failure is retried as filing only, never as a re-review.

Tests (plan-progress.test.ts, AC-PCR-5 title): re-review fails with the same fingerprint as the closed cover → a new issue is filed and the plan closes as accepted with known defects in the same batch; a second batch with nothing changed does not call the judge.
