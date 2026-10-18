---
id: PLAN-209
type: plan
role: plan
title: "The approval judge rejects patch-shaped designs"
status: approved
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-200
phases:
  - {name: "P1", description: "single change to the end state"}
---
## Overview

Implements spec-the-approval-judge-rejects-patch-shaped-designs-design in one change, straight to the end state: no phases, no transitional pieces.

| T | Task | ACs |
|---|---|---|
| DN-1 | Prompt v4 with the design_necessity rule (registered, current; v1-v3 frozen), plan added to the default judged types, one sentence in the shipped produce rule fragment, tests that pinned v3 updated, AC-DN-3 fixtures added | AC-DN-1, AC-DN-2 (AC-DN-3 run by the orchestrator on the real judge after merge) |

After merge the orchestrator: rebuilds dist, runs AC-DN-3 on the real judge (two runs per fixture), lands the spec's rule change set, re-renders the repo's own rules files.

## Invariants

- INV-1: no new check script, scanner or ledger; the approval gate is the only enforcement point.
- INV-2: v1-v3 prompt builders stay byte-identical (judgments recorded under them remain reproducible).
- INV-3: shipped behaviour is verified from the built binary, not only from source.

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Judge over-applies design_necessity and rejects legitimate designs | M | D1 exempts items the end state requires when the document says why; AC-DN-3 control fixture must not raise the finding |
| Draft plans in flight now need a judgment | L | Intended (spec Rollout); the refusal names the review command |
| Judge non-determinism | M | AC-DN-3 requires two agreeing runs per fixture |
