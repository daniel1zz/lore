---
id: TASK-1741
type: task
role: plan
title: "Claim side effects never skip silently: the commit trailer is always installed or the claim says why not, and an uninspectable working copy refuses release"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Found 2026-10-19 by the review judge on baseline-claim-a-task (design_necessity, class c): BR-1162's trailer hook is skipped silently when the hooks folder lies outside every working copy (real-git-port.ts:619, :722), and BR-144 lets a release go ahead when the claimed working copy cannot be inspected. End state: the claim installs the trailer wherever the repository's hooks live or refuses/reports visibly naming why; a release whose working copy cannot be inspected is refused naming why (force is the explicit route). AC: red-first tests for both paths with exact exit codes and refusal names. After landing: restate BR-1162 and BR-144, update the claim leaf.
