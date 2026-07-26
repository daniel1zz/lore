---
id: PLAN-062
type: plan
role: plan
title: "Implementation — SPEC-062 config write layer"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-07-21
tags: []
parent: SPEC-062
---
# Implementation — SPEC-062 config write layer

## Goal

Give `.lore/config.yaml` its first runtime write path, behind a safety model
that makes browser-reachable RCE / secret exfiltration structurally impossible
(4 denied keys), and that never reports a save as undifferentiated success
(PRD R-3 restart-vs-live).

## Sequencing

T1 (pure editability tables + ConfigService) is the foundation; T2 (HTTP
routes + If-Match + auth posture) consumes it. T2 is anchor-blocked on T1.

## Exit Criteria

- All 8 ACs attested via `lore verify`.
- `bun run typecheck` exit 0; both runners green.
- No dashboard-reachable write path exists for any CONFIG_DENY_KEYS entry.
