---
id: TASK-860
type: task
role: plan
title: "lore evidence --output-tail keeps the last 4000 chars while vitest prints failures first, so a red's attribution is lost by construction"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"evidence-fidelity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c27db251-af27-4263-8173-396eca523247"}
---

From handoff knowledge-handoff-agent-main-orchestrator-133, NS3, unfiled until now.

lore evidence --output-tail keeps the LAST 4000 characters. vitest prints its compact failure list FIRST, so for a multi-conjunct red the attribution - which assertion failed and why - falls OUTSIDE the window BY CONSTRUCTION, not by bad luck.

Measured again in the present session: the sole remaining ready task of plan-close-the-read-side-a-github-filed-defect-becomes carries a `fail` evidence row whose output_tail is exactly 4000 bytes, and the cause of that red is NOT recoverable from the record.

Neither obvious workaround holds: --reporter=dot still expands on failure, and --reporter=github-actions emits no summary line, which violates the standing rule that an evidence tail must carry the runner's own summary.

**Expected:** A failure's attribution survives in the record: either a head+tail window (keep the first N and last N characters with an explicit elision marker), or per-assertion structured results, so a reader of an evidence row can tell WHICH conjunct failed without re-running the command.
**Actual:** A multi-conjunct vitest red records a 4000-byte tail that contains the run summary but not the failure list, so the recorded evidence cannot answer which assertion failed.

Reported by: agent:main-orchestrator
