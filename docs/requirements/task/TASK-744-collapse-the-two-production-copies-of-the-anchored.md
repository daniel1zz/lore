---
id: TASK-744
type: task
role: plan
title: "Collapse the two production copies of the anchored predicate into one export and pin the ratchet witness with a differential table"
status: archived
priority: high
phase: "two-follow-ups"
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-133
plan: PLAN-133
---
# Task Objective

Collapse the TWO PRODUCTION copies of the "spec is anchored" predicate into one exported
definition, and bind the ratchet test's independent witness to it with a differential
boundary-case table — WITHOUT making the witness import it.

# Spec Reference

`spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`, `AC-BFI-14`.
Read the statement with `lore ac list` — it is the contract; this file is orientation.

Lineage: `AC-BFI-5` armed the ratchet, `AC-BFI-10` removed the circular membership check,
`AC-BFI-12` made AC-BFI-10's own falsifier drive the real assertion path. This closes the
residual none of them covered: the witness and the checker each hand-write the predicate.

# The three copies, read 2026-08-21

| Site | Code | Role |
|---|---|---|
| `scripts/check-anchor-coverage.ts:318` (`isSpecAnchored`) | `Array.isArray(raw) && raw.length > 0` on `extra["code_anchors"]` | the pre-push ratchet (`hooks/pre-push`, AC-BFI-9) |
| `packages/lore/src/flows/drift-flow.ts:281` (`countArmedSpecs`) | the same two lines | feeds the PUBLISHED `code_anchor_specs` field of `lore status --json` — consumed by both the CLI (`commands/status.ts`) and the MCP tool (`adapters/mcp/tools.ts:2717`) |
| `packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts:529` | the same test, over raw SQL rows | the INDEPENDENT WITNESS AC-BFI-10 exists to provide |

# What to build

**Half 1 — one production definition.** Export the predicate once (a pure, browser-safe
function in `@lore/core` is the natural home — `scripts/**` and `packages/lore/src/**` both
already import from it). Both production sites import it. Assert uniqueness REPO-WIDE with a
scan over `packages/**` and `scripts/**` for a second construction of the non-empty-array test
on `code_anchors` in EXECUTABLE code. ⛔ An enumerated file list is explicitly not the oracle —
the point is that a fourth copy appearing in a file nobody listed must go red.

⛔ Read the existing precedent before inventing a scan: `packages/lore/tests/unit/service/terminal-resolution-ssot.test.ts` already does repo-wide single-definition-site assertion for a different vocabulary. Match its shape rather than writing a third style of scan.

⛔ The scan must not match comments, doc blocks, or this repo's own corpus mirror under
`docs/requirements/**` — the corpus quotes source liberally, and a matcher that trips on prose
is a false red that will be silenced rather than fixed. Anchor structurally (an AST or a
tokenized scan), and pair it with a second independent condition, per the standing lesson that
marker censuses over a self-documenting corpus over-match.

**Half 2 — the witness stays independent, and is pinned by a table.** ⛔ Do NOT import the
shared predicate into `measureUnanchoredLiveSpecSlugsIndependently`. Its separateness is the
entire value AC-BFI-10 bought: a shared implementation lets one regression corrupt subject and
witness at once, which is the circularity, one level down. Instead add a differential case
table over a CONSTRUCTED fixture (not the live corpus) with exactly these five rows —
`code_anchors` absent, `[]`, a non-array value, a non-empty array, and a row with
`deleted_at` set — and assert the witness's classification equals the shared predicate's on
every row, failing with the offending case named.

# Verification discipline

- ⛔ Red first, recorded by YOU at the moment it is red, from inside this worktree:
  `lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail`.
- ⛔ The AC pass must be ATTESTED: `lore verify plan-close-the-two-bootstrap-fixpoint-follow-ups-one-anchored --task <this task>`.
  `lore evidence --capture` is NOT attested — it labels `capture_source: runner` but issues no
  attestation block, so pass/fail is still typed by you.
- ⛔ RUN both declared reds, do not describe them: (a) add a second inline non-empty-array test
  on `code_anchors` in some executable file and confirm the uniqueness scan fails NAMING that
  file; (b) flip one row of the differential table in the witness only and confirm the
  agreement assertion fails NAMING that case. Then revert both.
- ⛔ Do NOT run `lore ac set`. It demotes the governing spec and would freeze your sibling
  task's claim. The orchestrator declares the falsifiers after both tasks merge.
- ⛔ Changing `countArmedSpecs` changes a PUBLISHED field. Before and after your change, run
  `lore status --json` and confirm `code_anchor_specs` is unchanged (92 as of 2026-08-21 —
  re-measure, do not trust that number). A refactor that moves the number is a defect.
- ⛔ Also re-run the ratchet itself end to end: `bun scripts/check-anchor-coverage.ts`; it
  exits 0 today at "60 of 60 dispositioned". Measure the exit code WITHOUT a pipe
  (`cmd > out 2>&1; echo $?`).
- ⛔ Scoped oracles only in this worktree: `bun run test:changed <base>` is the deterministic
  selector, but it under-selects a tree-scanning test that names no literal path — and your
  repo-wide uniqueness scan is exactly that shape, so run it BY HAND.
- ⛔ `packages/core` is a monorepo sub-package: build it before typechecking any
  `packages/lore` consumer of a new export, or you will read an artifact red.
- ⛔ `@lore/core`'s default barrel must stay browser-safe — no top-level `fs`/`path`/`os`.
- ⛔ Never write to this repo's own `.lore/` from a test.

# File Anchors

- `scripts/check-anchor-coverage.ts`
- `packages/lore/src/flows/drift-flow.ts`
- `packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts`
