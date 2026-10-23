---
id: TASK-1751
type: task
role: plan
title: "Deprecating a spec retires its proposed rule ids in the same write or is refused"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Source: review of baseline-land-a-spec-s-rule-changes, 2026-10-19 (design_necessity, classes b/d). Moving a spec to deprecated is two separate writes: CorpusService.set first commits the status change (updateWithProvenance), then calls the rule-change landing port to retire the spec's still-proposed ids "never landed" (packages/lore/src/service/corpus-service.ts, the `newStatus === "deprecated"` block after the status write). If the second write fails, the spec stays deprecated with its proposed ids still reserved, and the error asks the operator to finish by re-running `lore rule apply <spec>` (BR-1307). That is a non-atomic intermediate state plus a manual recovery seam.

End state: deprecating a spec and retiring its still-proposed ids are one outcome. Either both are committed, or the deprecation is refused with the retiring failure named and nothing is written (the spec keeps its previous status, every proposed id stays proposed). The "re-run lore rule apply to finish" message and its comment are removed. Restate BR-1307 to that behaviour (deprecation refused, nothing written, when its proposed ids cannot be retired).

AC: red-first. With a landing port whose retire step fails, moving a spec to deprecated exits 4 (or the mapped refusal code), the spec's status is unchanged and its proposed ids are still proposed. Falsifier: today's behaviour (status deprecated, ids proposed, message naming `lore rule apply`). Happy path unchanged: a successful deprecation retires the ids "never landed: <spec>" in the same command.
