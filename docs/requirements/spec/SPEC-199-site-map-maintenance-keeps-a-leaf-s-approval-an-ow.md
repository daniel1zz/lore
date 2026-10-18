---
id: SPEC-199
type: spec
role: spec
title: "Site-map maintenance keeps a leaf's approval; an owned-by exclusion is a checked reference"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
---
# Spec: Site-map maintenance keeps a leaf's approval; an owned-by exclusion is a checked reference

## Overview/Goal

Make baseline completeness maintainable without destroying approval information or hiding stale references. Decision record: `adr-mapping-a-census-site-does-not-demote-a-baseline-leaf-an` (D1-D3). Amends SPEC-157 §C1/C2 (site map and coverage), which left the demotion question undecided; follows the spec-baseline-slice-1 Q3 precedent (`ac cite` does not demote).

Motivation (measured 2026-10-18): mapping 91 unmapped census sites would demote ~100 approved leaves whose rule text does not change; and `non-business:owned-by <leaf> BR-n — …` exclusions, the bulk of all mappings, are free text that nothing checks — mappings to retired rules and deleted functions were found.

## Scope

In:
- `baseline map` (all surfaces share the service path): a call that only sets or removes site mappings keeps an approved leaf approved and still logs one version + one audit entry; a call that adds or removes a declared command demotes as today.
- `baseline map` write-time check of an owned-by exclusion: the named node must be a baseline leaf, every named id a live rule of that leaf, and the reason after the dash non-blank; otherwise exit 4, nothing written.
- `baseline coverage`: an owned-by exclusion whose owner leaf is gone or any of whose named ids is no longer a live rule of that leaf counts as a gap.

Out: any other demotion path (rule add/set/move, glossary, depends, set-label, node content) is unchanged. Non-owned-by exclusion reasons stay free text (sampled by `baseline fidelity --exclusions`).

Grammar of an owned-by exclusion (the existing convention, now checked): `non-business:owned-by <leaf id or slug> BR-n[ BR-m …] — <reason>`; the separator is an em dash surrounded by spaces. A non-business reason that does not start with `owned-by ` is not affected. Also refused at map time: an owned-by naming no BR id, one without the spaced em-dash separator, and one naming the leaf being mapped itself (a leaf maps its own rules with `--rule`). The leaf may be named by id or slug; the stored entry keeps what the author wrote, and coverage resolves it again at every check, so an owner leaf that was renamed, deleted or turned into a branch makes the entry a gap until it is re-mapped. Existing owned-by entries that are stale when this lands become coverage gaps (that is the intent) and are repaired by plan-baseline-completeness-restoration-every-verb-declared-0 P1; no migration rewrites them.

## Acceptance Criteria

Declared as structured criteria with `lore ac add` (AC-SMM-1..3), each citing the rule it changes; rule changes are proposed in this spec's change set and land with `lore rule apply` at plan close.

- AC-SMM-1: site-only map on an approved leaf keeps it approved, +1 version, +1 audit `baseline-map`; a map call that also adds a command demotes (cites BR-658).
- AC-SMM-2: a malformed or stale owned-by exclusion is refused at map time with VALIDATION_ERROR and nothing is written: unknown node, a branch node, a retired rule, a live rule of a different leaf, a blank reason; a valid one is accepted (cites BR-654).
- AC-SMM-3: coverage counts an owned-by exclusion as a gap once its named rule is retired or moved to another leaf, or its owner leaf is deleted; a valid one is not a gap (cites BR-660).


## Acceptance Criteria (structured)

- [⊘] [script] AC-SMM-1: On an approved baseline leaf, a baseline map call that only sets or removes site mappings leaves the status approved, adds exactly 1 version and 1 audit row with operation baseline-map; the same call shape that also adds a declared command (and one that only removes a command) demotes the leaf to draft
  script: test — bunx vitest run packages/lore/tests/unit/service/site-map-approval.test.ts && echo 'AC-SMM-1 PASS: site-only map keeps approval, command change demotes'
- [⚑] [script] AC-SMM-2: baseline map refuses a non-business:owned-by exclusion with VALIDATION_ERROR (exit 4) and writes no version when the named node is unknown, is a branch rather than a leaf, is the leaf being mapped, no BR id is named, a named id is retired, a named id is a live rule of a different leaf, the spaced em-dash separator is missing, or the reason after it is blank; an owned-by naming a live rule of the named leaf (by id and by slug) with a reason is accepted, and a non-business reason not starting with owned-by is unaffected
  script: test — bunx vitest run packages/lore/tests/unit/service/site-map-owned-by-write.test.ts && echo 'AC-SMM-2 PASS: owned-by exclusions are checked at map time'
- [⚑] [script] AC-SMM-3: baseline coverage reports a site as a gap when its only mapping is an owned-by exclusion whose named rule has since been retired, moved to another leaf, or whose owner leaf was deleted; the same exclusion is not a gap while the rule is live on the named leaf
  script: test — bunx vitest run packages/lore/tests/unit/service/leaf-coverage-owned-by.test.ts && echo 'AC-SMM-3 PASS: stale owned-by exclusions are coverage gaps'

## Code anchors

- packages/lore/src/service/rule-service.ts
- packages/lore/src/service/leaf-coverage.ts
