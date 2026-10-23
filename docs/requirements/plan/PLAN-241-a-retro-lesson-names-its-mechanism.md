---
id: PLAN-241
type: plan
role: plan
title: "A retro lesson names its mechanism"
status: deprecated
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-202
phases:
  - {name: "P1", description: "one change"}
---
## Overview

Implements spec-a-retro-lesson-names-the-mechanism-that-stops-it-recurring in one change.

| T | Task | ACs |
|---|---|---|
| RM-1 | retro lessons contract in the service layer (create and every write that changes extra.lessons), CLI flags, MCP shape, informs link sync, CLOSE rule bullet, session-capture skill steps | AC-RM-1, AC-RM-2, AC-RM-3 |

## Invariants

- INV-1: enforced once, in the service layer; no adapter-specific check.
- INV-2: link sync touches only informs links whose target is or was a lesson mechanism.

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Existing callers that create retros break | M | every shipped skill/hook that creates a retro is updated in the same change; scoped tests over create/knowledge paths |
| Link sync deletes a hand-added informs link | M | INV-2 |
