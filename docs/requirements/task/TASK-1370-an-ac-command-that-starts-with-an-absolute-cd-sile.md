---
id: TASK-1370
type: task
role: plan
title: "An AC command that starts with an absolute cd silently measures the main checkout under lore verify --falsify and worktree execution roots"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"false-oracle","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"70dab1c1-357c-4f2d-a34b-7884f65719bc"}
---

lore ac add accepts a script command beginning 'cd /abs/repo && …' with no warning. lore verify --falsify mutates a scratch worktree and --execution-root targets a worktree, but such a command leaves both and runs against the unmutated main checkout.

**Expected:** lore ac add (or verify) refuses or warns on a command that cds to an absolute path inside the repo, naming the execution-root mechanism; or verify reports that the command left its execution root.
**Actual:** 2026-10-15: AC-RW-3 of spec-always-loaded-lore-fragments-state-the-rule-only-reasoning declared a falsifier with exit 1; lore verify --falsify refused 'mutated command actually exited 0' because the command cd'd to /Users/apple/Projects/zz/lore. After lore ac set --correction removed the cd, the same falsifier recorded an attested red (exit 1). Earlier, task-t1-agent-definitions-dispatch-hooks-setup-retirement-test's implementer could not verify AC-AT-1..6 from its worktree for the same reason.

Reported by: agent:session-3f2e7715
