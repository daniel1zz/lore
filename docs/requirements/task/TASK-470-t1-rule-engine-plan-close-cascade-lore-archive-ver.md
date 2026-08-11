---
id: TASK-470
type: task
role: plan
title: "T1 — rule engine + plan-close cascade + lore archive verb + injection surfacing (AC-097-1..5)"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-08-01
tags: []
parent: PLAN-089
plan: PLAN-089
---
Implement per spec R1-R4/D1-D5: (1) @lore/core computeArchiveCandidates pure engine + typed candidates; (2) cascade at the plan→archived commit path (per-doc status write + audit with cascade marker, fresh-claimed tasks skipped loudly, no rollback of plan archival); (3) commands/archive.ts: --sweep report-only exit 0/3 with per-candidate rule+reason+literal repair, --apply audited writes, lazy registration; (4) SessionService.bootstrap computes archive_candidates via the SAME core fn; buildBootstrapInjection includes it present-iff positive; (5) corpus-workflow maintenance-cadence bullet adds lore archive --sweep + manifest regen; (6) extend VALID_TRANSITIONS deliberately if draft→archived (or similar) is required, with schema comment; (7) tests per the five AC commands, RED-first.
