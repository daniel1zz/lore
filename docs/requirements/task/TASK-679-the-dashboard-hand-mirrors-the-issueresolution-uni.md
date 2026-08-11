---
id: TASK-679
type: task
role: plan
title: "The dashboard hand-mirrors the IssueResolution union with no type link, so both new terminal states render an undefined badge"
status: archived
priority: medium
phase: "read-surfaces"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-127
plan: PLAN-127
---
Verified by the M1 implementer, outside its anchors so it could only name the sites. api.ts:660 hand-mirrors the IssueResolution union and is missing both superseded and duplicate; IssuesList.tsx and IssueDetail.tsx each switch over it with NO default, so a superseded row yields an undefined Badge variant. ⛔ Nothing type-checks that mirror against @lore/core, so bun run typecheck stays GREEN and the drift is invisible — fixing the three sites without removing the hand-mirror leaves the same defect armed for the next union member. Replace the mirror with the imported union (or a type-level equality assertion against it) so the next addition fails to compile, and give both switches an exhaustive never-check rather than a default that silently absorbs an unknown state.
