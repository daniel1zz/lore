---
id: TASK-919
type: task
role: plan
title: "lore set with byte-identical content still logs a new version, so an empty diff row pollutes the history"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"audit-history","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"7c6c384e-d767-46fd-9631-afcddc4b4a8c"}
---

Running lore set <doc> --content-file F where F equals the current content succeeds and bumps the version (observed: an adr went v2 -> v3, and lore diff --from 2 --to 3 prints headers with no hunks). Version rows are the audit history; a no-op row is indistinguishable in lore log from a real edit, and any 'edited since approval' or churn census over versions counts it. Hit while a scripted read-modify-write failed mid-chain and the trailing lore set ran on unchanged content.

**Expected:** A write whose content/title/extra are identical to the current version is a no-op: exit 0 with a 'no changes' message and no new version row (or an explicit refusal).
**Actual:** exit 0, 'Updated <slug> -> v3'; lore diff v2..v3 is empty.
**Repro command:** `cd $(mktemp -d) && git init -q && lore init && lore create knowledge --sub-type reference --title K --content x && lore get knowledge-k --json | python3 -c 'import sys,json;open("f","w").write(json.load(sys.stdin)["data"]["doc"]["content"])' && lore set knowledge-k --content-file f && lore log knowledge-k`

Reported by: agent:main-orchestrator
