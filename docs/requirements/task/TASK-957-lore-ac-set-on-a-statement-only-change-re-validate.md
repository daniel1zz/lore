---
id: TASK-957
type: task
role: plan
title: "lore ac set on a statement-only change re-validates the command path and demands --allow-missing-path"
status: archived
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"tool-quirk","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"fb32695f-56e3-40ff-b542-176e7ed6ec5a"}
---

Changing only an AC statement re-runs the command-path existence check, so a red-first AC whose test file is not yet on disk needs --allow-missing-path again (user-04 prose). Documented today only as prose in the user layer (D4 of spec-rule-store-git-tracked-fragment-selection-on-demand-skill): the prose stays until this is fixed.

**Expected:** A statement-only edit does not re-validate an unchanged command
**Actual:** The unchanged command is re-validated and the edit refused without the escape

Reported by: agent:session-e25636da
