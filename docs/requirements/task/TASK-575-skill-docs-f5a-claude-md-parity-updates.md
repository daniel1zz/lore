---
id: TASK-575
type: task
role: plan
title: "[Skill:docs] F5a CLAUDE.md parity updates"
status: archived
priority: medium
phase: "Phase 4: E2E & docs"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-578, type: blocks}
---
Estimate: S
Approach: packages/dashboard/CLAUDE.md — retire "production build + serve static: defer" out-of-scope claims, document packaged topology (one-command entry, nonce auth, --dev retention, test:e2e:static). packages/lore/src/adapters/http/CLAUDE.md — document static-serving module, dispatch order invariant, nonce endpoint, degradation rules. Root CLAUDE.md Commands section only if command surface changed (test:e2e:static mention).
Source: spec Consumer contracts; landed behavior from Phases 1-3
Dimensions: D-DOC
Scope-Alt: none — doc parity is the task
Covers: (supports all ACs; no direct spec AC)

Stale claims to retire (verbatim targets in packages/dashboard/CLAUDE.md):
1. Out-of-scope bullet "Vite production build + `lore serve` mounting static (defer)." — shipped by this plan; remove.
2. Out-of-scope bullet "Embedding bundle into `dist/lore` binary (defer)." — shipped by this plan; remove.
3. The "Local-dev topology" section presenting the two-process (Terminal A/B) model as THE launch path — reframe as --dev-only; packaged one-command entry becomes primary.
4. Out-of-scope bullet "Session-expiry recovery UX (401 → guided re-bootstrap prompt)." — update to document the shipped re-auth path: re-run `lore dashboard` (nonce flow); keep richer UX out of scope explicitly.

AC:
- Given the landed implementation, When reading packages/dashboard/CLAUDE.md, Then none of the 4 enumerated stale claims remain in their old form (grep for the quoted fragments returns 0 matches) and the two-process dev topology is documented as --dev-only.
- Given the http adapter CLAUDE.md, When reading it, Then dispatch-order invariant (api → nonce → static → fallback) and the never-500-on-store-failure rule are stated.
