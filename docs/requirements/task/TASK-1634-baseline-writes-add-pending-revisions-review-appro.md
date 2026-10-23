---
id: TASK-1634
type: task
role: plan
title: "Baseline writes add pending revisions; review, approve and reject work per item; node status is derived; rule apply writes approved versions"
status: archived
priority: high
phase: "P1"
created: 2026-10-19
updated: 2026-10-20
tags: []
parent: PLAN-219
plan: PLAN-219
---
Implements end state items 2-5 of spec-baseline-approval-is-per-item-an-edit-adds-a-pending (BR-626, BR-627, BR-628, BR-648, BR-722, BR-1211, BR-1338, BR-1339): rule add/set/move, set-label, depends, glossary, map --command/--remove-command and body/title edits record a pending revision of one item (a second write replaces it), never demoting; lore rule apply writes approved versions and refuses while a changed rule holds a pending direct revision; lore review judges only pending revisions against approved versions; lore approve promotes exactly the reviewed revisions (stale -> exit 4 naming it), --item approves one, reject --item discards one; node status derived, status commands refuse baseline nodes. Uses T1's accessor. Do not touch site_map row code (lore-40's D1). Blocked by T1.
