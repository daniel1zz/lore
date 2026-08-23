---
id: TASK-782
type: task
role: plan
title: "[Skill:implement] migrate the 12 filed reports with a mandatory dry-run pass"
status: draft
priority: high
phase: "P3: Migration"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-780, type: blocks}
---
Estimate: M
Approach: a migration entry point with a mandatory dry-run first pass. Create then PATCH (state cannot be set at creation — verified against the official REST docs), concurrency 4 (~24 calls, ~4s measured). Corpus records are KEPT and updated in place, gaining extra.issue_report.github={repo,number} and a minted extra.issue_report.idempotency_key. Every step writes its intent to ReceiptLogV2 before the call.
Source: spec Migration Plan P3; the measured 12-report backlog (10 open, 2 terminal)
Dimensions: D-FUNC
Scope-Alt: concurrency may drop to 1 without blocking the plan — 12 reports at ~690ms each is under 10s serially
Covers: AC-GI-11

AC:
- Given the anchored test file from the paired red task, When it runs, Then all five cases pass
- Given dry-run mode, When it runs against the real backlog, Then it performs zero writes and its plan lists 12 creations and 2 closures
- Given the real migration, When it completes, Then 12 issues exist in the target repo, exactly 2 closed with a state_reason, and each of the six front-matter fields equals its corpus source
- Given the 12 corpus records after migration, When read, Then each carries both new extra fields
- A full-repo typecheck is exit 0
