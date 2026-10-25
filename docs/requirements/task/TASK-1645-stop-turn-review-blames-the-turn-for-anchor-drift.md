---
id: TASK-1645
type: task
role: plan
title: "stop-turn-review blames the turn for anchor-drift deletions that came from other sessions' landings moving the shared checkout"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hooks","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f70e1364-6c4a-4fd7-934e-8fe3556ee613"}
---

assets/hooks/stop-turn-review.mjs finding (b) diffs the working tree between the turn-start snapshot and turn end. When the session runs in the shared checkout, other sessions' lore integrate moves HEAD to main repeatedly during the turn (git reflog: 12 'checkout: moving ... to main' entries between 17:38 and 18:38 on 2026-10-20). Files those landings deleted (packages/core/src/actor-resolution-node.ts by 0060a789, packages/lore/tests/unit/service/actor-identity-guard.bun.test.ts by b77db9c4, packages/lore/tests/unit/core/actor-resolution-ignores-lore-actor.test.ts by 13adbcfa) were reported as 'a live spec anchors a file this turn deleted or renamed' and the Stop hook blocked the turn, although the session made no file edits (only lore corpus commands and a worktree subagent dispatch).

**Expected:** Deletions explained by HEAD moving between snapshot and turn end (paths deleted in git diff <snapshotHEAD>..HEAD) are not attributed to the turn; at most an informational line naming the landing commit and its session.
**Actual:** Turn-end review: 1 finding ... Anchor drift (a live spec anchors a file this turn deleted or renamed): spec-079-...: packages/core/src/actor-resolution-node.ts; spec-claim-time-actor-identity-guard-...: packages/lore/tests/unit/service/actor-identity-guard.bun.test.ts; spec-run-only-write-identity-...: packages/core/src/actor-resolution-node.ts, packages/lore/tests/unit/core/actor-resolution-ignores-lore-actor.test.ts
**Repro command:** `git -C <shared checkout> reflog --date=iso -12 HEAD; git log --oneline -1 main -- packages/core/src/actor-resolution-node.ts`

Reported by: agent:session-95a34914
