---
id: TASK-1525
type: task
role: plan
title: "[Skill:spec] CT-1 spec corrections C1-C9 with the user's three decisions; re-approve"
status: archived
priority: critical
phase: "Phase 1: re-measure"
created: 2026-10-17
updated: 2026-10-17
tags: []
parent: PLAN-202
plan: PLAN-202
links:
  - {id: TASK-1521, type: blocks}
  - {id: TASK-1517, type: blocks}
  - {id: TASK-1522, type: blocks}
  - {id: TASK-1515, type: blocks}
  - {id: TASK-1526, type: blocks}
---
Estimate: M
Approach: Apply spec corrections C1–C9 from knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine §3 with `lore ac set --correction` (or a content edit + re-approval), each recording the measurement that motivates it. User decisions (2026-10-17) fixed three open points: (a) C4 — evidence recorded with uncommitted changes in the working tree is classified "radius unmeasurable" and counted separately (AS-17), never treated as current; no tree digest; (b) AC-CT-6 is retired by correction (reason: the audit-id comparison is unreliable — ~26% of writes raise MAX(audit.id) without touching the mirror — and the full mirror check already runs in `bun run test`); (c) `lore done`'s per-task floor also refuses `unbound` evidence, enabled when the runner writes stamps (state it in AC-CT-3 or a new criterion). C9: CT commands use `bunx --bun vitest run`. Then lore review + lore approve the spec; update the test-governance not-built ledger (scripts/ac-oracle-not-built-ledger.json) to drop AC-CT-6 in the same change set.
Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it; measurements and design: knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine (§2 measurements, §3 corrections, §4 row for this task).
AC: lore ac list shows the corrected statements and commands; AC-CT-6 retired with its reason; spec approved.
Also (plan review 2026-10-17): (1) state where dirty-tree rows fall on each axis so AC-CT-9(c)/(d)'s five mutually exclusive stamp-verdict readings still sum to the row total; (2) retiring AC-CT-6 removes its rows from the spec's Scope table (export-docs-service corpus_rev, hooks/pre-push and assets/project/pre-push compare); (3) name the owner of AC-CT-4's 15% re-check trigger. Note on C4 wording: the user's decision is that dirty-tree evidence does NOT satisfy the attestation floor (R1's option (a) would have accepted it); encode that, not option (a).
