---
id: SPEC-164
type: spec
role: spec
title: "Fresh-install probe fixes: a fresh consumer can run the whole baseline loop"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-17
tags: []
---
# Fresh-install probe fixes: a fresh consumer can run the whole baseline loop

## Overview/Goal

The slice 3 exit criterion "fresh-install probe in a consuming project" was run on 2026-10-11 (compiled binary, mkdtemp project, `lore init` + `lore setup --project`): 29 steps pass, 12 fail, 10 defects (scratchpad report `fresh-install-probe.md`, summarized in the knowledge doc linked to this spec). The critical one: review's mechanical `tree_position` check rejects every parentless spec against the blueprint `setup --project` ships, so a fresh consumer cannot approve any spec. Goal: every defect fixed, and the probe itself automated as a script so the exit criterion is mechanically re-checkable.

## Scope

- F1: review's mechanical place check accepts a parentless spec (and stays a reject for a parentless doc of a type that needs a parent).
- F2/F3/F4: shipped skills (all under `assets/skills/`, installed to `~/.claude/skills/` by `lore setup`) — `assets/skills/lore/SKILL.md` lists `--parent` as required for spec; `lore-kickoff` says "Every spec needs a parent" and never creates a baseline leaf + rule before asking for `--cite`; `lore-baseline` advertises `baseline sites|coverage` to consumers, where the census cannot run (it analyses lore's own CLI source). The distribution oracle (AC-BLS3B-9) missed F2/F3 because it only matched `create spec` and `--parent` on one line — widen it.
- F5: `ac_cite.provenance` is `unaudited` for the value `setup --project` seeded (the skill defines unaudited as hand-edited).
- F7: `baseline adopt --mode enforce` with no armed branch reports enforce but refuses nothing, silently.
- F6: `status --json` baseline rule totals omit architecture (AS) rules (also issue #136).
- F8: the AC_CITE_REQUIRED refusal for an `ac add` suggests `lore ac cite` on a criterion that was not written.
- F9/F10: `tree --help` says the default root is the first PRD; `lore tree <prd>` draws depth-3 connectors wrongly.
- Probe automation: `scripts/fresh-install-probe.ts` builds nothing, takes the binary path, runs the walk in a mkdtemp project and exits 0 iff every step meets its expectation.

## Acceptance Criteria

Structured criteria AC-FIP-1..6 (`lore ac add`), each citing the rule it falsifies.

## Code anchors

Declared after landing.


## Acceptance Criteria (structured)

- [·] [script] AC-FIP-1: In a corpus whose lore.tree.yaml is the one lore setup --project ships, lore review of a parentless spec passes the mechanical tree_position check (no reject from it) while a parentless knowledge doc of a type the layout places under a parent still fails it — asserted by review-tree-position-parentless.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/review-tree-position-parentless.bun.test.ts && echo 'AC-FIP-1 PASS: parentless spec passes tree_position'
- [⚑] [script] AC-FIP-2: No shipped asset file (assets/**) states or implies a spec needs a parent: the scan fails on any line that pairs spec with --parent in any form (table cell, prose, command) or says a spec needs/requires a parent; lore-kickoff creates a baseline leaf and a rule before its spec step cites one; lore-baseline marks baseline sites/coverage as lore-source-only (not for consumer projects) — asserted by spec-parent-distribution-wide.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/assets/spec-parent-distribution-wide.test.ts && echo 'AC-FIP-2 PASS: shipped skills carry the no-parent contract everywhere'
- [⚑] [script] AC-FIP-3: After lore setup --project in a fresh corpus, lore status --json reports ac_cite provenance 'audited' (not unaudited) for the seeded mode; after lore baseline adopt --mode enforce with no armed branch, status lists armed branches [] and reports that enforce refuses nothing, and adopt prints that warning — asserted by ac-cite-provenance-fresh.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/ac-cite-provenance-fresh.bun.test.ts && echo 'AC-FIP-3 PASS: seeded mode audited; empty-armed enforce is visible'
- [⚑] [script] AC-FIP-4: lore status --json baseline rule totals (rules_total, rules_by_lifecycle, rules_by_verification) count architecture standard (AS) rules as well as business leaf (BR) rules: a corpus with 2 BR and 1 AS live rule reports rules_total 3 — asserted by status-rule-totals-both-trees.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/status-rule-totals-both-trees.bun.test.ts && echo 'AC-FIP-4 PASS: AS rules counted'
- [⚑] [script] AC-FIP-5: An enforce-mode AC_CITE_REQUIRED refusal of lore ac add suggests 'lore ac add ... --cite <rule>' and never 'lore ac cite' for the unwritten criterion; lore tree --help names the business baseline root as the default root; lore tree <prd> draws depth-3 connectors with the same prefix rules as depth 1-2 (golden output) — asserted by cite-hint-and-tree-render.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/cite-hint-and-tree-render.bun.test.ts && echo 'AC-FIP-5 PASS: hint and tree render'
- [⊘] [script] AC-FIP-6: scripts/fresh-install-probe.ts, given a compiled lore binary path, runs init, setup --project, baseline business+architecture trees, a rule, a parentless spec with a cited criterion, review, approve, an uncited spec's approval refused (exit 4), Implements/Implemented by, census, migrate spec-parents preview, bootstrap/tree default root, in a mkdtemp project, printing one PASS/FAIL line per step, and exits 0 iff every step meets its expectation
  script: test — bun run build > /dev/null 2>&1 && bun scripts/fresh-install-probe.ts --bin dist/lore && echo 'AC-FIP-6 PASS: fresh consumer runs the whole baseline loop'

## Code anchors

- scripts/fresh-install-probe.ts
- assets/skills/lore/SKILL.md
