---
id: PLAN-239
type: plan
role: plan
title: "Module index lists only folders with a memory file"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: SPEC-205
phases:
  - {name: "Phase 1: module index", description: "implement and adopt"}
---
## Overview
Implements spec-module-index-lists-only-folders-with-a-memory-file-managed (AC-MI-1..3). Unblocks CL-7 (task-skill-design-cl-7-lore-context-refresh-cannot-run-on-this).

| T | Task | AC |
|---|---|---|
| MI-T1 | module index = folders with a memory file (link + Purpose first sentence, count line for the rest); managed zone emits the template H2 headings; legacy auto:* blocks migrated once and reported; `lore context refresh --check`; BR-882 modify lands with the plan | AC-MI-1, AC-MI-2, AC-MI-3 (throwaway half) |
| MI-T2 | refresh this repository's root CLAUDE.md once (from a session worktree, landed through the normal merge path), then lore verify AC-MI-3 on main; close CL-7 | AC-MI-3 |

Dependencies: MI-T1 blocks MI-T2; MI-T2 blocks CL-7's archive.

## Invariants
- INV-1: no hand-written byte outside a managed zone or a migrated legacy block changes (AC-MI-2 asserts it).
- INV-2: nothing filtered without a count (North Star: must not go silent).
- INV-3: red-first per AC; AC-MI-1/2 ledgered not-built until their oracle lands.
- INV-4: refresh --check writes nothing (asserted by byte comparison).

## Risk Register
| Risk | Impact | Mitigation |
|---|---|---|
| The repo's hand-curated Module Index entries (8, with scope keywords) are replaced by Purpose first sentences that read worse | M | MI-T2 adds or fixes Purpose sections in the module CLAUDE.md files first, so the generated lines carry the scope keywords |
| Other repositories set up with older templates change on their next refresh | L | the change is reported by refresh's output (migrated blocks named) |

## Exit Criteria
AC-MI-1..3 attested pass on main; CL-7 archived.
