---
id: TASK-1649
type: task
role: plan
title: "The edit-time anchor hook declares scratch files and shell fragments as task anchors"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hooks","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c79ce701-7c4b-4f4d-8987-60c32e558565"}
---

The pre-edit anchor hook auto-declares every path a helper writes as a file anchor of its claimed task, including throwaway files: a scratch copy of a test that was created and deleted (packages/dashboard/tests/e2e/red-old-issues.spec.ts), .scratch-*.log files, and text fragments of sed commands recorded as paths. The stale anchors then block lore done (a declared test-file anchor needs a whole-file pass) and fill the 50-anchor cap, and a .scratch-build.log written by one helper was refused to another as held by a live claim.

**Expected:** only tracked source and test files the edit actually changes become anchors; gitignored, scratch and non-path strings never do, and an anchored file deleted before release is dropped
**Actual:** lore done refused: declared test-file anchor packages/dashboard/tests/e2e/red-old-issues.spec.ts (a deleted scratch copy) has no attested pass; earlier, sed fragments and .scratch files appeared as anchors

Reported by: agent:session-a979eecd
