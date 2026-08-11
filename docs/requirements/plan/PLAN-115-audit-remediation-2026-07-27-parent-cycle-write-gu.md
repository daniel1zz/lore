---
id: PLAN-115
type: plan
role: plan
title: "Audit remediation 2026-07-27 — parent-cycle write guard, MDX unknown-component strip, actor-identity guard"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-28
tags: []
parent: PRD-001
links:
  - {id: SPEC-002, type: implements}
  - {id: SPEC-004, type: implements}
  - {id: SPEC-090, type: implements}
---
# Audit remediation 2026-07-27

Remediates the three adversarially-confirmed implementable findings from knowledge-full-system-spec-compliance-audit-2026-07-27-85-11-1.

## Scope (3 tasks, one per finding)
1. **Parent-cycle write-time guard** (spec-corpus-schema §4.3): detectParentCycle must walk docs.parent_id (authoritative tree column) so create-time parent edges are visible; `lore link --type parent` forming a cycle → rejected LINK_CYCLE, exit 4. Regression: 2-node cycle repro from the audit.
2. **MDX unknown-component strip** (spec-prd-as-living-root §4): non-whitelisted components must be REMOVED from rendered output (security validation), warning surfaced on CLI stderr. Regression:  must not survive in `lore get` stdout.
3. **Actor-identity guard + zero-evidence release advisory** (spec-claim-time-actor-identity-guard-zero-evidence-release-advis, all 3 ACs): task-claim predicate rejecting os_default identity collisions (field gate:task-claim:actor-identity), workflow.gates."task-claim".actor_identity.enabled escape hatch, `lore release` zero-evidence advisory (exit 0 + warning line + warnings[] in --json/MCP).

## Out of scope (recorded in retro as DECISION REQUIRED)
Remote/multi-user domain (MCP streamable HTTP, device-auth human login, rate-limit enforcement), AC-NOAI-7, low-severity spec-text amendments.

## Oracle policy
Worktree agents run scoped oracles only (typecheck + touched test files); full two-runner suite runs once on main after merges.
