---
id: PLAN-192
type: plan
role: plan
title: "Defect backlog: baseline-mirror"
status: deprecated
priority: medium
created: 2026-10-16
updated: 2026-10-23
tags: []
parent: SPEC-193
---
## Overview
Draft backlog plan owning the in-repo lore defect reports of one area (see the parent spec). DRAFT on purpose: tasks are decomposed when it is picked up (lore-plan replan), then reviewed and approved as usual.

## Invariants
- INV-1: a report closes only through a merged, archived task that `resolves` it (computed 'fixed').
- INV-2: a fix that turns out simple is done in place (CLAUDE.md Dogfooding); nothing here is re-filed as an issue.
