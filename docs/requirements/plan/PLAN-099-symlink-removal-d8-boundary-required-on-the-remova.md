---
id: PLAN-099
type: plan
role: plan
title: "Symlink-removal D8 — boundary required on the removal ports"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: SPEC-117
phases:
  - {name: "Fix"}
---
# Plan — SPEC symlink-removal D8: boundary required on the removal ports

## Goal

Implement D8 of the approved spec `spec-lore-setup-deletes-repo-source-through-dev-symlinks`: move call-site enumeration from a remembered regex to the type checker by making `boundary` a REQUIRED property on `remove` and `removeProjectPath`, and close the suite-shrink hole an independent review found in AC-SL-4.

This is the mechanization the retro `Grepping the defect's shape finds it in the callee and misses every caller — one class, three escapes` identified after the same defect class escaped three times.

## Oracle

`lore verify` over AC-SL-7 (tsc, with a negative control fixture) and AC-SL-8 (suite-membership floor), plus AC-SL-1 … AC-SL-6 as an unchanged regression floor.

## Phases

Single phase (`Fix`) — one task. The port signature and every consumer of it must change atomically; a partial landing does not typecheck.

## Risks

- **A vacuous AC-SL-7.** `bun run typecheck` passing proves nothing about whether the parameter is actually required — a signature quietly left optional also typechecks. The negative control fixture (a call omitting `boundary` that tsc must REJECT) is the load-bearing half.
- **Runtime branch removal.** D8 explicitly keeps `remove`'s `boundary === undefined` runtime branch reachable and tested; deleting it would break the install-root-is-itself-a-symlink case D4 exists for.
- **Test doubles.** `MapFs`-style fakes and the project-flow fakes must supply a boundary; a double typed loosely enough to skip it re-opens the hole in test space.
- **Manifest churn.** This task must not commit `packages/lore/src/generated/assets-manifest.ts` — a concurrent task owns it.
