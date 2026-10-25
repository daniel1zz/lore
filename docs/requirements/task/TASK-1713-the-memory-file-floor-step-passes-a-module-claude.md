---
id: TASK-1713
type: task
role: plan
title: "The memory-file floor step passes a module CLAUDE.md that lore status reports over its byte ceiling"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"gates","tags":["memory-files","floor"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"8c92d55a-4a76-4645-847a-7544012413c1"}
---

Two oracles give opposite verdicts on the same file. On main at 350ad2c9, packages/lore/src/store/CLAUDE.md is 16448 bytes (module max_bytes ceiling 16384). The integrate floor step `bun run check:memory-files` (= `lore context refresh --check`) exits 0, so the commit that pushed the file over its ceiling (3289ef95) landed; `lore status --check-claude-md` exits 3 with a [max_bytes] finding, and the overage was found only afterwards by another session's turn-end review. Reproduced in a detached checkout of 350ad2c9 (read-only) on 2026-10-19.

**Expected:** One ceiling verdict per file shared by both: `lore context refresh --check` (the floor step) exits non-zero naming packages/lore/src/store/CLAUDE.md and max_bytes, so integrate refuses the branch.
**Actual:** `lore context refresh --check` exit 0: 'context refresh --check: every target is already refreshed and within its ceiling'. `lore status --check-claude-md` exit 3: '[max_bytes] packages/lore/src/store/CLAUDE.md is 16448 bytes, exceeding the module max_bytes ceiling of 16384'.
**Repro command:** `git worktree add --detach /tmp/r 350ad2c9 && cd /tmp/r && bun install --frozen-lockfile && bun run packages/lore/src/index.ts context refresh --check; echo $?; bun run packages/lore/src/index.ts status --check-claude-md; echo $?`

Reported by: agent:session-482f1e89
