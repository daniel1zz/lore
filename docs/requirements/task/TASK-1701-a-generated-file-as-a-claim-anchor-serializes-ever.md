---
id: TASK-1701
type: task
role: plan
title: "A generated file as a claim anchor serializes every asset change: integrate refuses any branch touching assets-manifest.ts while another task holds it"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"concurrency","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"ba1d52b5-3f93-4a98-916b-b10c463606df"}
---

packages/lore/src/generated/assets-manifest.ts is regenerated from assets/ by every change to any shipped asset, so every asset-editing task must anchor it. Anchors are exclusive (BR-1346), so two sessions editing unrelated assets (here: a close-guidance fragment vs project-config parsing and lore init scaffolding) cannot land concurrently: integrate refuses the second branch until the first task lands or releases. The conflict is not real: the file is a pure function of assets/ and could be regenerated at merge time. Observed 2026-10-19 integrating worktree-agent-ab021305af8e0f71f (task-igh-t1-close-guidance-and-root-claude-md-file-every).

**Expected:** Two branches that edit different files under assets/ land independently; the generated manifest is rebuilt from the merged assets/ (at integrate or build time) and is never an exclusive claim anchor, or its claim never conflicts with another claim on the same generated file.
**Actual:** lore integrate exits 4: 'BR-1346: the own change of worktree-agent-ab021305af8e0f71f is held by another live claim: packages/lore/src/generated/assets-manifest.ts held by task-skill-fix-an-unparsable-project-config-is-silently-ignored (anchor packages/lore/src/generated/assets-manifest.ts) … held by task-skill-fix-dc2-5-lore-init-is-one-atomic-scaffold-that … Wait for that task to land or be released, or move the change to another branch.'
**Repro command:** `lore integrate <branch that edits one assets/ file and regenerates assets-manifest.ts> while another live task anchors packages/lore/src/generated/assets-manifest.ts`

Reported by: agent:session-b2737a57
