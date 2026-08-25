---
id: TASK-861
type: task
role: plan
title: "check:no-nul-bytes is blind to untracked files, so an author checking a new file before commit gets a vacuous green"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"oracle-blind-spot","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"70862c4b-6aad-483c-b6b4-f68acdb5d77c"}
---

From handoff knowledge-handoff-agent-main-orchestrator-133, NS2, unfiled until now.

check:no-nul-bytes is BLIND to untracked files, measured paired: a file containing a NUL byte, left UNTRACKED, gives exit 0 and the message "considered 3410 tracked file(s)". The SAME file, staged, gives exit 1. So an agent authoring a NEW file and running the checker before committing gets a VACUOUS green.

That is exactly how a NUL byte reached main earlier in this project, and the downstream cost is documented: one raw NUL at offset 15160 made BSD grep suppress every match SILENTLY and exit 1 - byte-identical to "pattern absent" - which produced a false-green conclusion, a spec rewritten twice, and a spurious task.

**Expected:** The checker either scans untracked candidate files too, or it COUNTS AND REPORTS them as skipped-because-untracked, so a green verdict can never be read as "no NUL bytes anywhere" when the population it actually examined excluded the newest files. Silence about the skipped set is the defect; scanning is one fix, an honest count is the minimum.
**Actual:** An untracked file containing a NUL byte yields exit 0 and a message naming only the tracked population, with no indication that any candidate was skipped.

Reported by: agent:main-orchestrator
