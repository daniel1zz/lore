---
id: TASK-885
type: task
role: plan
title: "lore ac add/set accepts a script command whose pipeline masks the test runner's exit code"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"oracle-integrity","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"59c62089-ee21-4e8f-b147-c8bd5686f4f1"}
---

A script-mode AC command of the shape 'bunx vitest run X 2>&1 | tail -15 && echo PASS' was accepted by 'lore ac add' with no warning. Without pipefail the pipeline's exit is tail's (always 0), so 'lore verify' would record an attested PASS even when every test fails — a false oracle that the attestation label then certifies. Caught by the author on re-read, not by any gate.

**Expected:** ac add/set refuses (or at least warns loudly) when a script command pipes a runner's output into another command before '&&' without 'set -o pipefail', naming the masked segment.
**Actual:** Accepted silently; 7 ACs were stored with the masking shape before manual correction.
**Repro command:** `lore ac add <spec> AC-X --mode script --oracle test --command "false | tail -1 && echo PASS" --statement s`

Reported by: agent:main-orchestrator
