---
id: TASK-968
type: task
role: plan
title: "One unresolvable claim path (EACCES/ENOTDIR) makes seatClaims fail for every seat's session-start injection"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"correctness","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"d92876b1-3b69-49cf-988d-d25d30b1cdba"}
---

SessionService.seatClaims (spec-session-start-injection-carries-only-the-session-s-own D12) resolves every absolute claim.worktree through the realpath port; ENOENT falls back to path.resolve, any other error is rethrown and fails the whole read. A single claim recorded by ANOTHER session with a path under an unreadable directory or through a file therefore makes lore bootstrap --injection exit non-zero for every seat, and the hook records a degradation. Fail-loud is D12's intent, but the blast radius crosses sessions. Found by lore assess on plan-session-start-injection-carries-only-the-seat-s-own-items (2026-10-12).

**Expected:** A claim whose path cannot be resolved fails only its own comparison (reported, e.g. as a per-claim warning in the payload or stderr), never other seats' injection
**Actual:** seatClaims returns an error for the whole corpus scan; every seat gets a degraded session start

Reported by: agent:session-cb37af5d
