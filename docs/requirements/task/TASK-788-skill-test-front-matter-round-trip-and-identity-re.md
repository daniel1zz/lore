---
id: TASK-788
type: task
role: plan
title: "[Skill:test] front-matter round trip and identity redaction RED scenarios"
status: archived
priority: high
phase: "P2: Intake"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
---
Estimate: S
Source: AC-GI-6 of the governing spec; Risk R1 (public disclosure)
TDD-Role: red | Paired-Impl: the frontMatterCodec task in this phase

Scenarios:
- Given a report whose reporter identity was built from an absolute home path, When the body is assembled, Then the assembled text contains neither the seeded home path nor any substring of it beyond the tilde form
- Given a seeded distinctive OS username, When the body is assembled, Then that username appears nowhere in the output
- Given a round trip of all six front-matter fields (severity, category, tags, reporter_corpus, reporter_root_prd, idempotency_key), When the body is parsed back, Then every field equals its input
- Given a category containing markdown control characters and a newline, When the body is assembled and parsed back, Then the value survives intact and does not break the front-matter delimiters
- Given a body with no front matter at all, When it is parsed, Then the codec returns an explicit absent result rather than a silently empty record

AC:
- Every scenario exists as an executable vitest case in the anchored file
- Seeded values, never ambient ones: reading the real $HOME or the real username would make the same test pass vacuously under a CI account and false-positive on a laptop
- The anchored file exits non-zero before the paired implementation lands
- `lore evidence --result expected-fail` recorded BY THIS TASK when the red is observed
