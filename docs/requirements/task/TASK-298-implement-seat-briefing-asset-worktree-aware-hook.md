---
id: TASK-298
type: task
role: plan
title: "Implement seat-briefing asset + worktree-aware hook injection + tests"
status: archived
priority: medium
created: 2026-07-16
updated: 2026-07-17
tags: []
parent: PLAN-039
plan: PLAN-039
---
Full contract in SPEC-047 (lore get spec-spec-047-session-seat-auto-briefing-worktree-aware-sessions). Deliver: (1) assets/governance/seat-briefing.md template ({{ACTOR}}/{{BRANCH}}/{{MAIN_CHECKOUT}} placeholders, team-generic English); (2) assets/hooks/session-start-resume.mjs linked-worktree detection (git-common-dir vs git-dir) + placeholder-substituted injection, fail-open, main-checkout path byte-unchanged; (3) assets-ssot.test.ts manifest+placeholder updates; (4) new session-seat-injection.test.ts (worktree-inject / main-unchanged / missing-file fail-open / exotic branch sanitize). Oracles: AC-047-A + AC-047-B + typecheck.
