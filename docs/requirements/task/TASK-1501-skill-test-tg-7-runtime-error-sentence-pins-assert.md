---
id: TASK-1501
type: task
role: plan
title: "[Skill:test] TG-7 runtime error sentence pins assert constants or rule tokens"
status: draft
priority: medium
phase: "Phase 2: clear offenders"
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PLAN-201
plan: PLAN-201
links:
  - {id: TASK-1493, type: blocks}
  - {id: TASK-1496, type: blocks}
---
Estimate: M
Approach: About 12 tests pin whole runtime error sentences (examples: migrate-ordinals compiled test :410, assess-ai :721, plan-exempt-attestation :795, spec-mirror-export :1168). Locate them with a grep for 5+-word string literals compared against command output; replace each with the exported message constant, the error code, or the rule token the consumer acts on. A sentence a user or script copies (a remedy command) is a contract: keep it and add a prose-pin ledger entry naming the consumer.
Source: spec-test-governance-guards-that-refuse-bad-tests-declared
AC: AC-TG-9 (part) — each changed test still goes red when its rule is removed (show one red per file in evidence).
