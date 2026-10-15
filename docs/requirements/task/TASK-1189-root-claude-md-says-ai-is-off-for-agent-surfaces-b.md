---
id: TASK-1189
type: task
role: plan
title: "Root CLAUDE.md says AI is OFF for agent surfaces, but lore review calls the AI judge from an agent session by design"
status: draft
priority: medium
created: 2026-10-09
updated: 2026-10-09
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"doc-code-contradiction","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"e55b1076-37bf-41ef-9c7b-fc7b14e4d2b4"}
---

Found by the W5 probe author of plan-baseline-review-branch-migration-the-first-branch-eligible. A reader of CLAUDE.md predicts the wrong behaviour.

**Expected:** The SPEC-024 paragraph in root CLAUDE.md names the commands the agent-surface AI default applies to (create), or says review is exempt (its help text: review defaults to AI on every surface)
**Actual:** CLAUDE.md 'AI Default Behavior by Caller Surface' reads as a global AI-off for agents; lore review with CLAUDECODE=1 still calls the judge; only --no-ai or explicit config stops it (exit 2), as review.ts help text states

Reported by: agent:main-orchestrator
