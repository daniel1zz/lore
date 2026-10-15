---
id: TASK-1002
type: task
role: plan
title: "Record-edit gate makes falsifier declaration impossible on an approved spec"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"governance","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"1f60be56-54e5-4eb8-a6f8-f732d13d6ad2"}
---

spec-documents-are-living-or-records-a-locked-record-is-never refuses lore ac add|set|rm on a locked (ever-approved) spec; ac cite is exempt. --falsifier-* can only be declared through ac add/set, and ac set has no --correction exit. CLAUDE.md North Star asks every oracle to name its smallest red mutation via --falsifier-*, and the natural time to declare one is after the code lands (the path must exist) — i.e. after approval. Measured on plan-documents-are-living-or-records-record-edit-gate close-out: all 10 AC-DR criteria attested, zero falsifiers declarable without lore reopen, and reopen is refused once evidence exists.

**Expected:** A falsifier (oracle-strength metadata, not the criterion statement) can be declared or replaced on a locked spec through an audited path — e.g. ac cite-like exemption for the falsifier fields only, or ac set --correction
**Actual:** lore ac set <locked spec> <AC> --falsifier-* exits 4 gate:record-edit; lore reopen exits 4 because the criteria have evidence

Reported by: agent:session-cb37af5d
