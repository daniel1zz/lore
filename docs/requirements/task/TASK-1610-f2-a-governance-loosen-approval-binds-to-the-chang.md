---
id: TASK-1610
type: task
role: plan
title: "F2 a governance-loosen approval binds to the changed class entry, not the whole record version, so a batch of approvals all apply"
status: archived
priority: medium
phase: "F"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-212
plan: PLAN-212
---
Defect found while applying the owner's in-session answers on 2026-10-23. The owner accepted governance-loosen decisions 462 (ac-exempt tier → milestone) and 463 (retire report-issue) in one AskUserQuestion call, and the hook recorded both.

Re-running `lore autonomy set ac-exempt --tier milestone` applied it as write record 477. Re-running `lore autonomy set report-issue --retire` did not apply. It created a new pending decision, 478, because the approval's subject is bound to the version of the whole governed record, which the first apply changed.

So N approvals in one batch apply only the first. That breaks the batch rule (BR-1366's principle) and asks the human the same question again.

Fix: bind a governance-loosen decision's subject to the specific change, meaning the class id plus that class entry's before-value (hash), not the whole record version.
- An approval stays valid while that class entry is unchanged, whatever else in the record changes.
- An approval is voided only when that same entry changed. In that case it is a different question.
- Several approved loosenings of different classes then apply in any order.

Reference: Kubernetes server-side apply field ownership. A write conflicts only on the fields it manages, not on the whole object's resourceVersion.

Tests:
- Two loosenings of different classes are approved, then both re-runs apply, in either order.
- A loosening approved and then preceded by another change to the SAME class entry is refused as stale.
- The audit chain stays valid.
