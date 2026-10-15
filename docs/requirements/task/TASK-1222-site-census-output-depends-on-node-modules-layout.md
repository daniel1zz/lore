---
id: TASK-1222
type: task
role: plan
title: "Site census output depends on node_modules layout: when @lore/* resolves outside the analysed root, every cross-package refusal site silently disappears and coverage reports complete"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"oracle-determinism","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"6b2ae888-928b-45b4-a4f3-48af5f4641ac"}
---

Slice-2a specification backfill: in a worktree whose node_modules entries symlink to the main checkout, @lore/core resolved to main's packages/core (outside the census root), so all packages/core sites (parseCodeAnchor, normalizeFileAnchors VALIDATION_ERROR, Telemetry/AIProvider interface calls) were absent; coverage exited 0 and the agent recorded AC-BLS2-12 pass. The same commit on main reports 2 gaps + 2-4 not_measured per leaf (exit 1). A completeness oracle whose verdict changes with dependency layout reports 'complete' by omission — the North Star's vacuous-pass case.

**Expected:** Census resolves workspace packages from the analysed repo's package.json workspaces regardless of node_modules; a site outside the root that is reached is reported (not_measured) rather than dropped; identical commit gives identical site keys
**Actual:** Same commit 653cca85: worktree run → 0 gaps; main run → approve-a-spec 2 gaps 4 not_measured, create-a-spec 2 gaps, declare-a-code-anchor 2 gaps

Reported by: agent:main-orchestrator
