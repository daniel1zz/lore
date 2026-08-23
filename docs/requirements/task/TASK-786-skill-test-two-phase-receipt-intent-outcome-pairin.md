---
id: TASK-786
type: task
role: plan
title: "[Skill:test] two-phase receipt intent/outcome pairing RED scenarios"
status: draft
priority: high
phase: "P2: Intake"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-785, type: blocks}
---
Estimate: S
Source: AC-GI-3 of the governing spec; Risk R4 (halfway create-then-PATCH)
TDD-Role: red | Paired-Impl: the ReceiptLogV2 task in this phase

Scenarios:
- Given a filing whose network call fails, When the receipt log is read, Then an intent line exists for the idempotency key and no outcome line exists for that same key
- Given a filing that succeeds, When the log is read, Then both an intent and a matching outcome line exist for the key
- Given a retry with an already-used idempotency key whose outcome line exists, When the log is consulted, Then the prior outcome is discoverable rather than a second intent being treated as fresh
- Given a legacy receipt file written under the old three-field strict schema, When the v2 reader runs, Then the legacy rows remain readable and are not reported as corrupt
- Given a truncated final line (a crash mid-append), When the log is read, Then the parseable prefix is returned and the partial line is reported, never silently dropped

AC:
- Every scenario exists as an executable vitest case in the anchored file
- The anchored file exits non-zero before the paired implementation lands
- The fourth scenario pins the reason v2 uses a NEW file path: adding fields to the existing `.strict()` schema would make new lines parse-fail on an older binary
- `lore evidence --result expected-fail` recorded BY THIS TASK when the red is observed
