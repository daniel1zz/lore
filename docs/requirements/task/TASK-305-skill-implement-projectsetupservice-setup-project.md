---
id: TASK-305
type: task
role: plan
title: "[Skill:implement] ProjectSetupService + setup-project flow + test (AC-046-C)"
status: archived
priority: high
phase: "services"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
links:
  - {id: TASK-301, type: blocks}
---
Estimate: M
Approach: Implement `ProjectSetupService` (repo-target scaffold) + `flows/setup-project-flow.ts`, consuming the existing `lore init` service path. SEPARATE service from SetupService (global-machine vs repo-target split); commands/setup.ts and commands/init.ts never import each other.
Source: SPEC-046 Design (service/project-setup-service.ts + flows/setup-project-flow.ts).
Dimensions: D-FUNC, D-CODE
Scope-Alt: none.
Covers: AC-046-C

Boundary (IMPORTANT): ProjectSetupService does NOT import from `service/setup-service.ts`. It defines its own local fs/writer port shape (or reuses only the PURE @lore/core setup-manifest schema if a manifest is written) — no cross-import from the global-install service. This keeps the global-machine vs repo-target split clean, mirroring the DriftCheck/TaskWorkflow anchor-command precedent (blocked by core-pure only, NOT by the setupservice-lifecycle task).

Scaffold steps: `lore init` (existing service path) + copy assets/project/ hooks (g1–g4) + pre-push + lore.tree.yaml + `git config core.hooksPath hooks`.

AC:
- Given `bunx vitest run packages/lore/tests/unit/service/project-setup-service.test.ts`, When it runs, Then it exits 0.
- Given a throwaway git repo (mkdtemp + git init), When ProjectSetupService.scaffold() runs, Then: .lore/ is initialized, hooks/g1..g4 + pre-push are present, lore.tree.yaml exists, and `git config --get core.hooksPath` returns `hooks` (assert via git in the temp repo).
- Given a re-run over an already-scaffolded repo, When scaffold() runs again, Then existing files are reported skipped (idempotent, no clobber).
- Test-safety (I6): the temp repo is mkdtemp-created; the test NEVER touches the real repo's .lore/.
- Oracle: `bunx vitest run packages/lore/tests/unit/service/project-setup-service.test.ts` exits 0.
