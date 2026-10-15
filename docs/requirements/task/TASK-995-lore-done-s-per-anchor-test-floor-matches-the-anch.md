---
id: TASK-995
type: task
role: plan
title: "lore done's per-anchor test floor matches the anchor path literally, so an attested run under (cd packages/lore && bun test tests/...) does not count"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"false-refusal","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"05beb7e9-3b26-4075-a506-2dda93ce99be"}
---

task-claim-conflict-lore-done-and-ready-overlap-decide-by-run declares anchor packages/lore/tests/integration/run-owned-done-and-overlap.bun.test.ts. Its governing AC-ROI-3 command is '(cd packages/lore && bun test tests/integration/run-owned-done-and-overlap.bun.test.ts)'. lore verify ran it attested: exit 0, 13 pass. lore done still refused with 'declares test-file anchor(s) with no attested UNFILTERED result:pass run'. A --capture row whose command names the full repo-relative path from the repo root was then accepted. The floor compares command text to the anchor string and ignores the cd prefix, so the spec's own attested AC command can never satisfy it.

**Expected:** An attested unfiltered run counts for an anchor when the command's effective path (cd prefix resolved against the execution root) equals the anchor; at minimum lore verify's declared-scope run counts
**Actual:** Only a command whose text contains the anchor path literally counts; the verify attestation of the declared AC command is ignored, which forces a duplicate capture row

Reported by: agent:session-e25636da
