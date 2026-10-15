---
id: TASK-1175
type: task
role: plan
title: "lore status --check-claude-md reports 'within budget' and 'the file conforms' when the project has no CLAUDE.md"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"vacuous-pass","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d9ccb0b8-2b4a-4df8-bd9d-d7fb7ddcde2a"}
---

Found by the fast-mode cross-branch probe author (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, W0) on a throwaway corpus / code reading; not fixed there.

**Expected:** A missing CLAUDE.md is reported as missing (not measured), never as conforming
**Actual:** Exit 0 with 'within budget' / 'the file conforms' and no headroom figures when CLAUDE.md is absent

Reported by: agent:main-orchestrator
