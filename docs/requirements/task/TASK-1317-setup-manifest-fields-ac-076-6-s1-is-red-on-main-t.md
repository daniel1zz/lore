---
id: TASK-1317
type: task
role: plan
title: "setup-manifest-fields AC-076-6.S1 is red on main: the second no-op converge rewrites the manifest because the recorded settings.json sha256 changes"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"test-red","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"3bcc5a1e-749e-49bc-bc6e-7f03ba631fe0"}
---

packages/lore/tests/integration/setup-manifest-fields.bun.test.ts 'two consecutive no-op converges — the second fires zero underlying file writes and installed_at stays byte-identical' fails; stable from the second run on.

**Expected:** Two consecutive no-op converges: the second writes nothing and installed_at is byte-identical.
**Actual:** Measured on main at 101fd79b (before any change of this session's plan): 6 pass, 1 fail — AC-076-6.S1; the first converge records a settings.json sha256 that the second converge then differs from and rewrites.

Reported by: agent:session-3f2e7715
