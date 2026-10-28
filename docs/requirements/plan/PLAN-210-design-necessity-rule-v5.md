---
id: PLAN-210
type: plan
role: plan
title: "Design-necessity rule v5"
status: archived
priority: high
created: 2026-10-18
updated: 2026-10-25
tags: []
parent: SPEC-201
phases:
  - {name: "P1", description: "one change per concern"}
---
## Overview

Implements spec-design-necessity-rule-v5-separate-what-a-design-needs-from in one change per concern, straight to the end state.

| T | Task | ACs |
|---|---|---|
| DN5-1 | Prompt v5: refined design_necessity rule (non-findings i-iv, findings a-d, explicit per-item classification), registered and current, v1-v4 frozen; corrected end-state fixture; iterate the wording against the real judge until AC-DN5-2 holds in two runs per fixture | AC-DN5-1, AC-DN5-2 |
| DN5-2 | `lore rule propose <spec> amend <BR-n>` rewrites a proposed add in place; audited correction on a locked spec; refuses a non-proposed id | AC-DN5-3 |

DN5-1 and DN5-2 touch disjoint files and run in parallel. After both merge the orchestrator follows the spec's Landing order.

## Invariants

- INV-1: no new check script, scanner or ledger.
- INV-2: v1-v4 prompt builders stay byte-identical.

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Judge stays unstable on the control | M | DN5-1 iterates wording against the real judge (bounded) and reports every transcript; a residual instability is reported, not hidden |
| amend used to rewrite live rules | M | refused by id class; live rules keep the modify path |
