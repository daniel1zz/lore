---
id: TASK-005
type: task
role: plan
title: "Draft SPEC: HTTP AI provider"
status: archived
priority: medium
created: 2026-06-30
updated: 2026-06-30
tags: []
parent: PLAN-001
plan: PLAN-001
---
Track B · Task B2

Source: SPEC-017 §3.5 already reserves config slot for kind: "cli" | "http" but only ships "cli".

Goal: Stub SPEC for the HTTP provider variant. Resolve:

- Auth model: bearer token via env var (parallel to LORE_SYNC_TOKEN)?
- Streaming vs sync — currently SPEC-017 is sync; HTTP could enable streaming
- Provider config shape: { kind: "http", url, model, headers }?
- Retry / timeout semantics distinct from cli path
- Telemetry shape — same ai.generation event?

Deliverable: spec-http-ai-provider in draft, listing config schema + 8-12 ACs.
