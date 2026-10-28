---
id: TASK-2043
type: task
role: plan
title: "Land gs-integration (plan-github-owns-issue-report-state): merge main into it, adapt to main's changes, floor green"
status: archived
priority: medium
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PRD-001
---
Resolves the stalled landing of plan-github-owns-issue-report-state (handoff knowledge-handoff-agent-session-b2737a57, NS1+NS2). Owner decision 2026-10-25: take over and land GS, because its carrier model (extra.issues; close on carrier archive) is the end-state that makes an adopted-but-never-closed report impossible (incident: #363 adopted by plan-defect-reports-carry-their-own-context, archived without closing).

Work, in a new worktree branched from gs-integration (ecc100a9), never by removing .claude/worktrees/gs-int:
1. Merge main (538 commits ahead, incl. spec-defect-reports-carry-their-own-context-a-checked-repro: report-issue-repro.ts, report-issue-context.ts, new body sections in report-issue-wiring.ts, MCP fields). Resolve conflicts keeping BOTH: GS's carrier model and main's later features.
2. Adapt to main per NS1: run-identity claims (71801cc2), BR-1346, main-ref guard, schema migrations renumbered after main's latest, site_map removal, GS D3a/D3b.
3. NS2: fix AC-IS-3 of spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired; carrier-model prose in spec-074's mirror and packages/dashboard/CLAUDE.md.
4. bun run check:floor exit 0; scoped tests of every touched area; GS spec ACs green.
Not in scope: lore issues migrate --apply (public GitHub writes, owner approval), lore done of the GS tasks, rule apply (main agent after landing).
