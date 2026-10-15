---
id: TASK-741
type: task
role: plan
title: "Correct the three mistyped AC oracle commands and drive all four recorded reds to an honest terminal state"
status: deprecated
priority: high
phase: "corpus-cleanup"
created: 2026-08-21
updated: 2026-10-10
tags: []
parent: PLAN-079
plan: PLAN-079
---
# Task Objective

Close the FIRST half of M6.4: correct the three mistyped AC oracle commands and drive all
four recorded reds to an honest terminal state. Measured 2026-08-21 — the four reds are
byte-for-byte the 2026-08-10 baseline named in AC-OX-11, unchanged in eleven days.

# Spec Reference

`spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a` §M6.4 (first half), D5
("Correct the three commands or retire them → correct in place, re-attest").

# The four reds, each with its measured cause (2026-08-21)

| AC | Render | Declared command's path | Reality |
|---|---|---|---|
| `AC-061-7` | `✘(1/3, 3 attested)` | `packages/core/tests/acceptance.test.ts` | MISSING. Real file is `packages/core/src/acceptance.test.ts` — `@lore/core` colocates tests in `src/`. `AC-061-8` already exists as the corrected sibling and is green `⚑✔(3/0, 3 attested)`. |
| `AC-062-3` | `✘(1/1, 1 attested)` | `packages/lore/tests/unit/http/config-routes.test.ts` | MISSING. Real file is `packages/lore/tests/unit/adapters/http/config-routes.test.ts` — the `adapters/` segment is absent from the declaration. |
| `AC-062-5` | `✘(1/1, 1 attested)` | same file as AC-062-3 | same missing `adapters/` segment. |
| `AC-064-7` | `✘(0/1)` | four `packages/dashboard/tests/e2e/*.pw.ts` files | ⛔ ALL FOUR PATHS EXIST. This red is NOT a typo — it is a self-reported fail (0 pass / 1 fail, NOT attested). Its cause is unmeasured. Do not assume it is a false red. |

⛔ The plan's phase table says "three mistyped commands"; that count is correct and covers
AC-061-7 / AC-062-3 / AC-062-5 ONLY. AC-064-7 is the fourth red and needs a real run, not
an edit.

# Acceptance Criteria

This task declares `--ac-scope ""` deliberately: its outcome is a CORPUS state (the fail
population), and the oracle that observes that state is `AC-OX-11`, built by the sibling
task `task-build-the-corpus-fail-census-oracle`. Recording per-AC evidence here without
that census would be a self-report about a population nobody enumerated.

Done means, for each of the four:

1. A command that names a path which EXISTS (verify with `test -e`, not by eye).
2. A fresh `lore verify` attested run — `exit_code` present, `output_tail` non-empty and
   carrying the runner's own summary line.
3. Either an attested `pass`, or an attested `fail` that is a REAL defect with a filed
   follow-up. ⛔ A red that is genuinely red must stay red. Editing an oracle until it
   passes is indistinguishable in the audit trail from covering up a failure.

For `AC-061-7` specifically, decide and RECORD which of these it is, in the spec's
re-baseline log: (a) correct its path and re-attest, or (b) retire it in favour of the
already-green `AC-061-8` — `AC-061-8`'s own statement says it "corrects AC-061-7's path",
so two live criteria currently assert the same property with one of them permanently red.
Option (b) is the honest reading, but it MUST be recorded as a supersession, not a
deletion: `lore ac rm` fails while evidence references it, and it should — three attested
rows point at it.

# Context Digest

- ⛔ `lore ac set` DEMOTES its spec to `draft` (the `ac add` / `ac set` asymmetry is
  measured and documented in the root CLAUDE.md). Editing AC-062-3 and AC-062-5 drops
  SPEC-062 to draft; editing AC-061-7 drops SPEC-061. Both MUST be returned to `approved`
  in the SAME session via `lore review` + `lore approve` — `lore approve` requires a review
  verdict against the CURRENT version, so a pre-edit review is already invalid.
- ⛔ Every in-flight AC revision MUST be recorded in each spec's re-baseline log with three
  things: the original command, the exact observation that prompted the change, and why it
  is a correction rather than a weakening. Three of eleven ACs were revised this way in a
  prior slice and `lore assess` still cut `evidence_integrity` from 86 to 68 — the pattern
  itself is the risk, and visibility is the only mitigation.
- The dashboard e2e suite needs its own harness: see `packages/dashboard/tests/e2e/global-setup.ts`
  for the throwaway-corpus pattern. ⛔ Never let an e2e run write to this repo's `.lore/`.

# File Anchors

None declared. This task's writes land in the corpus (three specs' AC records), not on
tracked files. ⛔ That means the `task-claim` anchor-overlap gate CANNOT see it — an
unanchored task is invisible to the mutex. If a concurrent task edits SPEC-061/062/064 ACs,
the collision will be silent. Check `lore ready <plan> --json` sessions before claiming.

Read-only during verification (do NOT edit):
- `packages/core/src/acceptance.test.ts`
- `packages/lore/tests/unit/adapters/http/config-routes.test.ts`
- `packages/dashboard/tests/e2e/{read-flow,write-flow,browse-ux,review-loop}.pw.ts`
