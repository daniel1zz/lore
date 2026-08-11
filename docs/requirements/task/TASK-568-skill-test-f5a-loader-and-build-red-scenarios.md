---
id: TASK-568
type: task
role: plan
title: "[Skill:test] F5a loader and build RED scenarios"
status: archived
priority: high
phase: "Phase 1: Build & assets"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-586, type: blocks}
---
Estimate: S
Source: AC of the paired impl task (build embed + loader), spec DD-1
TDD-Role: red | Paired-Impl: build embed + loader
Dimensions: D-FUNC

Scenarios:
- Given the generated manifest module is ABSENT, When the loader is imported and queried, Then it returns { available: false, reason } naming `bun run build` — and never throws.
- Given a generated manifest module with two fixture entries, When the loader is queried, Then it returns { available: true, manifest } exposing urlPath → { embedded, contentType, immutable } and the build stamp { digest, builtAt }.
- Given `bun run typecheck` on a checkout with no generated manifest, When it runs, Then it exits 0 (loader has no static import of the generated module).

AC:
- All scenarios exist as executable tests in packages/lore/tests/unit/dashboard-assets-loader.bun.test.ts.
- Run tests → all RED; failure reason is "missing implementation" (loader module absent), not a test bug.
