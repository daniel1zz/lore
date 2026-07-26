---
id: ADR-012
type: adr
role: decision
title: "Dashboard cookie-session writes attribute author via resolveActor chain, never literal system"
status: draft
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
links:
  - {id: TASK-315, type: informs}
---
## Context

Docs created through the dashboard's cookie-session write surface record `author: "system"` (dogfood 2026-07-26 ISSUE-006). The audit trail elsewhere works hard to keep provenance (SPEC-035 audit, SPEC-042 actor discipline, SPEC-071 session-tier actor resolution) — a literal "system" on every UI write is a provenance hole, and it diverges from how every other surface resolves identity.

## Decision

Dashboard cookie-session writes attribute the author via the SAME server-side actor-resolution chain the CLI uses (`resolveActor` semantics: explicit > $LORE_ACTOR > session tier > OS username) evaluated in the `lore serve` process. The literal string "system" is never a default author on any write path. Bearer-token (agent) writes keep their existing attribution (key name / explicit `by`) — this decision covers only the cookie surface, where the server and the human share a machine (SPEC-016 local-bootstrap model), making the OS username the honest fallback identity.

## Consequences

- Audit rows and version history from UI writes become attributable and consistent with CLI-originated rows on the same machine.
- Multi-user remote deployments (not a current target — SPEC-016 is local-first) would need a real user identity tier before this fallback is meaningful there.
