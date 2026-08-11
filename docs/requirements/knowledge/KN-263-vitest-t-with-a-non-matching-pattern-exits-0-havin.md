---
id: KN-263
type: knowledge
role: knowledge
title: "vitest -t with a non-matching pattern exits 0 having run nothing: the sixth false-oracle vector, and it is NOT the loud path-filter case"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
MEASURED 2026-08-01 at main, three runs against scripts/tests/check-test-budgets.test.ts:

    -t "reported as new debt"          -> EXIT=0, Tests 1 passed | 31 skipped (32)
    -t "orphaned and fails loud"       -> EXIT=0, Tests 1 passed | 31 skipped (32)
    -t "THIS_SHOULD_MATCH_NOTHING_XYZ" -> EXIT=0, Test Files 1 skipped (1), ZERO tests executed

## Why this is a NEW vector, not the one already catalogued

CLAUDE.md standing lesson #1 records five false-oracle vectors, and its vector (1) is about
mistyped AC *path* filters: "vitest silently drops non-matching path filters, PARTIAL match
exits 0 (zero-match exits 1, loud)". The loudness of the zero-match case is what makes that
vector survivable.

That guarantee DOES NOT TRANSFER to `-t` name filters. A `-t` pattern matching nothing exits
**0** with zero tests executed. There is no signal at all: the run is indistinguishable from
a pass, in exit code and in the absence of any error line. Path filter zero-match = loud.
Name filter zero-match = silent. Anyone who generalised "zero-match is loud" from the
catalogued lesson to `-t` is wrong, and this repo depends on that generalisation being right.

## Blast radius in this repo, right now

Acceptance criteria bound to `-t` filters are one test-rename away from becoming permanent
green that measures nothing. Confirmed live examples on
`spec-a-test-case-s-timeout-budget-must-be-declared-when-its` alone:

  AC-TB-2 -> bunx vitest run scripts/tests/check-test-budgets.test.ts -t "control fixture is reported"
  AC-TB-3 -> ... -t "threshold boundary two versus three"
  AC-TB-5 -> ... -t "unparseable file is loud"

Each currently matches. Nothing in the pipeline asserts that it STILL matches. `lore verify`
records these as runner-attested passes, so the attestation machinery would faithfully
certify a criterion that executed zero assertions.

## Countermeasure applied here

D7 was added to that spec: the ledger contract (AC-TB-6) is verified by running the WHOLE
oracle file with no `-t` filter. Running whole also removes partial-pass ambiguity.

## The mechanization this actually calls for (NOT built here)

Prose telling authors to prefer whole-file runs is the wrong layer -- a defect already covered
by prose is proof the prose layer failed. The real fix is at the `lore verify` layer, which
already mechanizes false-oracle vectors 1-4 (SPEC-061 AC-061-9/10, SPEC-063): after any
`-t`-filtered AC command, assert the executed-test count is >= 1 and fail the run when a
filter matched nothing. The runner already parses runner summaries for the AC-061-11..17
work landed 2026-07-31, so the summary line it needs is already in hand.

## Standing rule

An oracle that "passed" proves a command ran. It never proves the command measured anything.
For any filtered run -- path, name, tag -- the count of what actually executed is part of the
evidence, not an implementation detail.
