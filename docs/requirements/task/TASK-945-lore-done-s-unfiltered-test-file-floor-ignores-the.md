---
id: TASK-945
type: task
role: plan
title: "lore done's unfiltered test-file floor ignores the e2e oracle: an attested 'bun run build && … bun test <file>' AC pass never satisfies its own anchor"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"attestation-floor","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"84161277-5152-4be6-8836-06b7cf0aeb05"}
---

A compiled e2e AC (oracle e2e, command 'bun run build && cd packages/lore && bun test tests/e2e/<file>.bun.test.ts'), passed under lore verify with an attestation, does not satisfy lore done's 'unfiltered oracle:test pass for EACH declared test-file anchor' floor, because the floor only counts oracle:test rows. Measured 4 times on 2026-10-12 (tasks for AC-CC-2, AC-SI-2, AC-WS-2/3): each time a duplicate --oracle test --capture row of the same file had to be recorded by hand before lore done would archive. The duplicate row proves nothing the attested e2e row did not.

**Expected:** An attested pass of oracle e2e (or any script oracle) whose command runs the anchored test file unfiltered counts toward the floor
**Actual:** Only oracle:test rows count; every compiled e2e AC needs a hand-recorded duplicate

Reported by: agent:session-cb37af5d
