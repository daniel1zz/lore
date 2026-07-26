---
id: KN-087
type: knowledge
role: knowledge
title: "SPEC-056/057 autopilot execution learnings: FK migration invariant, semantic merge conflicts, RED-first at scale"
status: approved
priority: medium
created: 2026-07-19
updated: 2026-07-24
tags: []
parent: PLAN-068
links:
  - {id: PLAN-068, type: informs}
---
# SPEC-056/057 autopilot execution learnings (2026-07-19/20)

Retro knowledge from the 3-plan autopilot run (SPEC-056/057/058), complementing the per-incident dogfood rows in CLAUDE.md.

## 1. migration-006 FK/DROP-TABLE false invariant (production-grade catch)
"DROP TABLE is safe under PRAGMA foreign_keys=ON" was asserted from a synthetic-fixture test and was FALSE against real data: the live corpus's FK-referencing children (links/versions/review_judgments/calibration_records + self-referential parent_id) made DROP TABLE docs throw, cascading into a misleading "already another table" error. Correct recipe (SQLite-documented): bracket table-recreate migrations in PRAGMA foreign_keys=OFF/=ON OUTSIDE the transaction. Lesson: a schema-migration invariant is only proven against a REAL-corpus backup copy (sqlite3 .backup), never fixtures alone — now part of the migration checklist. Defensive backup: .lore-safety-backups/ (git-ignored, deletable by owner).

## 2. Cross-worktree semantic conflicts auto-merge silently
T11/T12 both wired the same services; git auto-merged app.ts TEXTUALLY clean but semantically duplicated (TS2300 caught it). Lesson: after merging two branches that touched one file, run typecheck BEFORE archiving — textual merge success is not integration success. The contended-surface pattern that worked: one task isolates construction into a dedicated module (phase-wiring.ts), the other consumes it — pre-declared in both bundles.

## 3. RED-first pipeline at scale
The TDD two-pass (RED task pins a CONTRACT NOTE header; paired implement task treats it as authoritative) survived 5 concurrent worktrees with zero contract drift. The computed-specifier dynamic-import technique (knowledge-spec-058-…) was used by every RED task; T4's side-effect fixture import (re-running SPEC-042's 17 cases verbatim) is the reference pattern for rename regressions.

## 4. Follow-ups (deliberate, not forgotten)
- SPEC-057 D6 dirty-handoff warning: isDirty machinery landed, commands/handoff.ts wiring deferred (no AC covered it).
- task-workflow-service.ts coexists with phase-workflow-service.ts (additive phase-claim, not a rename) — retirement belongs to a post-migration cleanup task once the live corpus is migrated (lore migrate tasks-to-phases exists now; running it on the live corpus is an OWNER decision, not autopilot's).
- Pre-existing tree drift: 3 orphan knowledge docs (2026-06-28/07-19, no parent_id) — predates these plans.
- lore assess finding (058): attested_evidence_ratio 0.24 across implement tasks — the phase model's checklist attestation (now landed) is the structural fix; validate on the next plan run.
