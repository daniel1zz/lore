---
id: TASK-1624
type: task
role: plan
title: "Applying a deprecated spec has nothing to retire: retire-on-apply is removed once no deprecated spec holds a proposed id"
status: deprecated
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-206
plan: PLAN-206
---
Found 2026-10-19 by the review judge on baseline-land-a-spec-s-rule-changes (design_necessity, class d): since BR-1307 retires a spec's proposed ids in the same write as its deprecation, BR-1212's 'applying a deprecated spec retires its still-proposed ids' can only fire for specs deprecated before BR-1307. End state: the schema upgrade retires any proposed id of an already-deprecated spec once, and applying a deprecated spec writes nothing and says it is deprecated (BR-1212 restated); the retire-on-apply code path is deleted. AC: red-first test that apply on a deprecated spec writes nothing; upgrade test that a deprecated spec's proposed id becomes retired 'never landed'; grep that the retire-on-apply branch is gone. After landing: restate BR-1212 and update the land-a-spec leaf.
