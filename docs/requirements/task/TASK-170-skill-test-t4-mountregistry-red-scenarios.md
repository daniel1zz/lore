---
id: TASK-170
type: task
role: plan
title: "[Skill:test] T4 MountRegistry RED scenarios"
status: archived
priority: critical
phase: "Phase 2: Server wave"
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PLAN-038
plan: PLAN-038
links:
  - {id: TASK-169, type: blocks}
---
Estimate: S
Source: AC of task t5 (MountRegistry implementation); spec-078 D2 + AC-078-1.
TDD-Role: red | Paired-Impl: T5 MountRegistry implementation
Dimensions: D-FUNC

Scenarios:
- Given a registry of 2 valid mkdtemp corpora, When MountRegistry.init runs, Then both entries classify mountable and expose live Apps.
- Given an entry whose path lacks .lore/, When init runs, Then it classifies missing with a diagnosis naming the path, and is never passed to createApp.
- Given a corpus with a bumped PRAGMA user_version, When init runs, Then it classifies schema-skew naming both versions AND the corpus file sha256 is byte-identical before/after.
- Given two entries with the same name, When the registry config loads, Then validation rejects before any probe.
- Given a registry where every entry is invalid, When init runs, Then MountRegistry is running with 0 mounts and no throw.

AC:
- All scenarios written as executable bun tests in packages/lore/tests/unit/mount/mount-registry.bun.test.ts.
- Run tests → all RED; failure reason is missing implementation, not test bugs.
