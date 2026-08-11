---
id: TASK-597
type: task
role: plan
title: "T1 parent-cycle write-time guard — detectParentCycle walks docs.parent_id"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-115
plan: PLAN-115
---
Fix spec-corpus-schema §4.3 violation (audit-confirmed): detectParentCycle (sqlite-store.ts:1088) walks only the links table; create-time parent edges write only docs.parent_id and are invisible, so 'lore link A B --type parent' can persist a 2-node parent cycle. Required: cycle detection walks docs.parent_id (authoritative) — reject with LINK_CYCLE, CLI exit 4. Apply equivalently in TursoStore. Tests: regression reproducing the audit's 2-node cycle (create child with --parent, then link parent->child as parent type → rejected); deeper chain cycle; legal reparent still allowed. Six-dimension coverage on the changed surface.
