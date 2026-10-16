---
id: ADR-009
type: adr
role: decision
title: "Dashboard positioned as general admin console — owner overrule of adjudication-cockpit consensus"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: SPEC-204
links:
  - {id: SPEC-204, type: informs}
---
## Context
The 6-role ideation panel (knowledge-ideation-dashboard-capability-expansion-6-role) recommended a narrower adjudication cockpit; 4/6 roles warned of dual-write-surface consistency cost.

## Decision
Owner (2026-07-24) positioned the dashboard as the team's GENERAL ADMIN CONSOLE over the corpus — full CRUD affordances and staged execution-operation surfaces. Batch ordering also owner-decided: adjudication workbench first (D2), overruling the consensus ranking.

## Consequences
Structural bound making this safe: GateEnforcer runs at the service layer, so every dashboard write passes the same deterministic gates as CLI/MCP — console breadth can never become gate bypass. Residual: UX-affordance risk; each new write surface pays the SPEC-062-class consistency tax; batches staged + telemetry-gated. Home = resolved living PRD directive unchanged. Dissent recorded, not hidden.

## Source
Extracted verbatim-in-substance from PRD §21 (now spec-domain-overview-dashboard-console-admin-console-evolution-adjudication-workbench-first) during SPEC-080 T7b owner-decision extraction.
