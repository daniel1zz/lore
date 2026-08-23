---
id: TASK-751
type: task
role: plan
title: "Build the hybrid dependency materializer and prove mutation observability, not just runnability"
status: draft
priority: medium
phase: "P1-materialization-core"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-135
plan: PLAN-135
---
Create packages/lore/src/service/falsifier-dep-materialization.ts exporting a materializer that, given a scratch worktree directory and the main repo root, builds the hybrid layout the ADR fixes: a REAL <scratch>/node_modules of symlinks to every top-level entry of the main node_modules (dotted entries such as .bin INCLUDED) except the workspace scope, plus a REAL <scratch>/node_modules/@lore whose entries point at <scratch>/packages/<name>, plus every nested packages/*/node_modules symlinked to its main-checkout counterpart. The workspace member set MUST be derived at runtime (read the main node_modules/@lore listing, or the workspace globs) — a hand-listed array fails AC-SD-2 by construction.

⛔ The trap this task exists to avoid: a plain ln -s of the main node_modules makes the green control pass and is therefore indistinguishable from success at the runnability layer, while every bare-specifier import of a workspace package resolves back to the ORIGINAL checkout. Measured 2026-08-23 — a syntax error injected into a scratch tree packages/core/src/index.ts left the target test at exit 0, 77 passed. AC-SD-3 is the load-bearing criterion here, not AC-SD-1.

Write packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts covering AC-SD-1 (describe "hybrid layout"), AC-SD-2 (describe "derived workspace set"), AC-SD-3 (describe "mutation observability"), AC-SD-4 (describe "main checkout untouched"). Read each criterion verbatim via lore get on the spec before writing — every one names its exact assertions AND its RED directions, and the RED directions are part of the deliverable: each must be demonstrated red at least once and that red recorded with lore evidence --result expected-fail AT THE MOMENT IT IS RED, by you, in this worktree.

Six-dimension coverage applies. Do NOT touch verify-runner-service.ts — wiring is a later phase with its own task and its own anchor.
