---
id: TASK-738
type: task
role: plan
title: "Compute the frozen-file-list population as content-union-subprocess and name a file content scanning cannot reach"
status: draft
priority: medium
phase: "backlog-and-arm"
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-079
plan: PLAN-079
---
# Task Objective

Make the test-file population behind every frozen-file-list AC oracle in this slice a
COMPUTED union of content discovery and subprocess reasoning, and prove the union is
computed by naming at least one file that content-marker scanning alone cannot reach.

# Spec Reference

`spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a`, `AC-OX-7`, and D7
(the KD4 residual).

Declared command:

    bunx vitest run packages/core/tests/unit/ac-falsifiability.test.ts -t population-union

Measured 2026-08-21: `packages/core/tests/unit/ac-falsifiability.test.ts` EXISTS. The
`-t population-union` case is what must be added.

# Acceptance Criteria

`AC-OX-7` — the population is COMPUTED as the union of content discovery and subprocess
reasoning, and the computation names at least one file that content-marker scanning alone
does not reach.

Declared RED: restrict the computation to content markers only, and the named
subprocess-style file must DISAPPEAR from the population. ⛔ Run that red.

⛔ Read AC-OX-7's last sentence literally: it asserts the union is COMPUTED, **not** that it
is complete. Do not widen the AC into a completeness claim — completeness is explicitly a
non-goal here (D7: "not fully mechanisable"). An oracle that promises completeness and
delivers a union is the failure mode this whole spec exists to close.

# Context Digest

- D7 states the defect: "a content-marker scan is structurally blind to a subprocess/scan-style
  test naming no marker". This is the SAME residual documented for `bun run test:changed` in
  the root CLAUDE.md — a tree-scanning test that names no literal path is invisible to
  content-based selection. Read
  `knowledge-bun-run-test-changed-full-selection-contract-and-its` before designing the
  subprocess half; that doc holds the measured selection contract.
- D7 records this was twice-measured in one slice (AC-FALS-12, AC-FALS-13). Read both on
  their spec before writing the computation — they are the two concrete instances the union
  must cover.
- ⛔ The file you name as "reachable only via subprocess reasoning" must be named by the
  COMPUTATION, not hardcoded in the assertion. A test that asserts `population.has("X")`
  where X is a literal is satisfied by a hardcoded return — that is a non-discriminating
  oracle of exactly the kind `lore assess` has caught twice in this repo after attestation.
  The assertion must be: content-only computation LACKS it, union computation HAS it, both
  computed by the same code path under different inputs.
- Runner: `.test.ts` → vitest. `packages/core` colocates some tests in `src/`; this one is
  under `tests/unit/`, so keep it there — the declared command names that path.

# File Anchors

- `packages/core/tests/unit/ac-falsifiability.test.ts`
