---
id: TASK-1333
type: task
role: plan
title: "Repo-tracked .claude/skills/lore/SKILL.md is a hand-synced copy of assets/skills/lore/SKILL.md and has drifted"
status: archived
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"ssot-drift","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"96b46bd0-c385-4412-9cc9-e444e817f85c"}
---

The lore repo tracks .claude/skills/lore/SKILL.md, updated by hand in feature commits (e.g. 686d16e1, cc2edf6a). It is a second copy of the shipped asset that no generator writes and no oracle compares. After spec-lore-owned-agent-context-is-generated-from-templates-and it still says '23 lore_* tools' and lacks the evidence-tail line, while the installed expansion of the asset says 45 and 4000.

**Expected:** The repo's .claude/skills copies are produced by the same install path (RealAssetSource expansion) or not tracked, with an oracle that fails on drift
**Actual:** diff of expanded assets/skills/lore/SKILL.md vs .claude/skills/lore/SKILL.md: missing tail line; 45 vs 23 tools

Reported by: agent:session-ee1cedaf
