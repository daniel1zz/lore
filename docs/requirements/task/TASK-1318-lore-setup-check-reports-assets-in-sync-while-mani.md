---
id: TASK-1318
type: task
role: plan
title: "lore setup --check reports 'assets in sync' while manifest-tracked files the payload no longer ships are still installed"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"silent-verdict","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"cd254626-025d-4a1c-9d4f-dbb52899d794"}
---

Freshness check ignores pending removals: only --dry-run shows 'Would remove', and the real converge receipt does not list what it removed.

**Expected:** setup --check reports any manifest-tracked path absent from the current payload as out of sync (pending removal), and a real converge prints the paths it removed.
**Actual:** 2026-10-15 (task-t1-agent-definitions-dispatch-hooks-setup-retirement-test): an install tracking agents/lore-explorer.md and agents/lore-reviewer.md after both left assets/agents/ printed 'assets in sync' under --check; --dry-run listed both under 'Would remove'; the --yes converge removed them without listing them.

Reported by: agent:session-3f2e7715
