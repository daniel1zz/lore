---
id: TASK-1687
type: task
role: plan
title: "check-ac-oracle-ownership reports superseded criteria whose test files were deleted as missing-owner-file"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"checks","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"b4211526-0f9d-4946-b425-665d63672c7c"}
---

scripts/check-ac-oracle-ownership.ts walks every acceptance criterion and reports missing-owner-file when its first test file does not exist. It does not skip criteria marked superseded_by. Superseding a criterion is exactly what happens when its behaviour is retired and its test deleted, so the check fails the integrate floor for retired behaviour (observed: AC-069-1, AC-ACTOR-1..5, AC-IDENTITY-REJECT/ESCAPE, all superseded, failing the floor of the identity branch).

**Expected:** a superseded criterion is not checked for an owner file (verify already skips it); only live criteria are
**Actual:** check-ac-oracle-ownership: FAIL — missing-owner-file for superseded AC-069-1, AC-ACTOR-1..5, AC-IDENTITY-ESCAPE, AC-IDENTITY-REJECT
**Repro command:** `bun run check:ac-oracle-ownership (on a branch that deletes the test file of a superseded criterion)`

Reported by: agent:session-a979eecd
