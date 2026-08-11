---
id: TASK-671
type: task
role: plan
title: "The knowledge sub-type is a retrieval filter applied in the store query, so pagination windows the filtered set"
status: draft
priority: medium
phase: "sub-type-filter"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-126
plan: PLAN-126
---
Implements M3 of the governing spec. The predicate lands in StoreInterface.findMany, never as a post-filter. AC-RR-5/6/7.
