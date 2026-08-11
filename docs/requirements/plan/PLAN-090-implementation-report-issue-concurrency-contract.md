---
id: PLAN-090
type: plan
role: plan
title: "Implementation — report-issue concurrency contract"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: SPEC-115
---
## Plan

Implements spec-report-issue-has-no-specified-concurrency-contract-ac-072 (6 ACs). D1 forbids any implementation commit before the evidence task writes the literal exit code and message template into the spec.
