---
id: PLAN-216
type: plan
role: plan
title: "RQ: every refusal carries its rule (required, type-checked); census removed"
status: approved
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: [redesign, baseline, errors]
parent: SPEC-230
---
## Goal

Implement `spec-every-refusal-carries-its-rule-as-a-required-type-checked`. All work lands as ONE integration branch, `rq-integration`, so main never has an optional-rule phase.

## Preconditions

- D1-1 has landed on main.
- The main agent has exported the 712 unplaced corpus mappings to a reference knowledge doc and then removed every leaf's `extra.site_map` key (AC-RIC-6).
- `spec-baseline-approval-is-per-item-an-edit-adds-a-pending` has dropped BR-628's site-map sentence, before this plan's landing.

## Tasks

1. **RQ-1: the type and the id check (AC-RQ-1 fixture part, AC-RQ-2).** Cut `rq-integration` from main.
   - Make `LoreError.rule` required, typed by error code.
   - Add the floor check script for live rule ids, wired into `check:floor`.
   - Run `bun run typecheck` and write the list of unlabelled constructions, grouped by module, to the task's evidence. This list sizes and splits the labelling tasks.
2. **RQ-L-*: label each module (AC-RQ-1 repo part, AC-RQ-4).** One task per module group, each created from RQ-1's list and run on a sub-branch merged into `rq-integration`.
   - Each label is set in the predicate or check that decides the refusal.
   - The reference doc's mappings are hints only.
   - A refusal with no describing live rule is reported for a spec change, never given a guessed rule.
   - Each task adds chokepoint pass-through assertions for the shared paths it labels.
3. **RQ-C: remove the census (AC-RQ-3).**
   - Delete the site census, `lore baseline sites`, the site sections of coverage, and the `@lore-site` tags.
   - Supersede D1's census criteria AC-RIC-1, AC-RIC-3 and AC-RIC-7 with AC-RQ-1, AC-RQ-4 and AC-RQ-3.
4. **Landing.** Integrate `rq-integration` once `bun run typecheck` and `check:floor` pass on it. Then run `lore rule apply` on this spec and on D1's spec, after D1-2 has landed.
