---
id: PLAN-221
type: plan
role: plan
title: "Known-party writes: attested runs and registered human sessions only"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-225
phases:
  - {name: "P1"}
  - {name: "P2"}
---
## Goal

Implement `spec-every-write-is-made-by-a-known-party-an-attested-agent-run`: every write is made by an attested agent run, a registered human session, an HTTP key or a dashboard login; no name fallback.

## Phases

- **P1 code**: T1 resolver, human session (token file in the user's lore state directory keyed by checkout path, only its hash in the registry), the harness-marker declaration every `lore setup` integration carries (Claude Code: CLAUDECODE=1), refusal, MCP and HTTP runs, and status/attribution reports counting by run, human, api-key and dashboard (AC-HID-1, AC-HID-2, AC-HID-6). T2 claims compare runs only, store refuses run-less claims, legacy-claim expiry in the schema upgrade, deletion of the fallback code, and `lore migrate config-keys` removing `actor_identity` from a project config (AC-HID-3, AC-HID-4, AC-HID-5); blocked by T1 (both change how a claim's identity is resolved).
- **P2 corpus**: after P1 lands: `lore verify`, `lore rule apply`, re-review and approve `baseline-attribute-work-to-a-run` and `baseline-claim-a-task`; update the shipped skill and rules text about unattested writes; tell every peer session that writes now need a run or a human session.

## Risks

- Every session without a working agent integration loses write access when T1 lands; the refusal must name the exact fix. Peer sessions run with the integration, so they keep working.
- Test fixtures that spawn lore without a harness run must register a human session or a run; T1 owns making the shared fixtures do that.
