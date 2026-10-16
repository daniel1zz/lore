---
id: PLAN-191
type: plan
role: plan
title: "Ship the defect-report scoping rule in the CLOSE fragment"
status: archived
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: SPEC-191
phases:
  - {name: "Phase 1: fragment", description: "edit the CLOSE fragment bullet, regenerate rules + manifest, test"}
---
## Overview
One-task plan (task-skill-implement-close-fragment-scopes-defect-reports-br) implementing spec-the-shipped-close-guidance-scopes-defect-reports-lore (BR-1153). Steps: (1) edit the report-issue bullet of assets/context/corpus-workflow-4-close.md; (2) regenerate the repo's compiled .claude/rules/lore-corpus-workflow-close.md with `lore context refresh`; (3) regenerate packages/lore/src/generated/assets-manifest.ts with `bun run build`; (4) add the AC-ISCOPE-1 test.

## Invariants
- INV-1: in assets/context/ only the report-issue bullet of corpus-workflow-4-close.md changes (one hunk); the only other changed files are the two regenerated artifacts (.claude/rules/lore-corpus-workflow-close.md, packages/lore/src/generated/assets-manifest.ts), any test updated for the old wording, and the new test.
- INV-2: AC-ISCOPE-1 holds in full: (a) the bullet says 'one root cause' and routes the repo's own upkeep to plan/task; (b) the compiled rules file is byte-identical to a fresh render; (c) `lore fragments check` exits 0.

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| The compiled rules file or the manifest drifts from the edited fragment because nobody re-rendered them | M | steps (2) and (3) are part of the task; AC-ISCOPE-1 (b) asserts byte identity |
| A test pins the old bullet's literal wording (#227 class) | M | grep packages/*/tests and scripts/tests for the old sentence; update and run every hit |

## Decisions Log
- D1 (user, 2026-10-16): change both layers; the user-level fragment is already updated outside the repo.
