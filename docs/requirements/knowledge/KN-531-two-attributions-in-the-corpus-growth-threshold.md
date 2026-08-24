---
id: KN-531
type: knowledge
role: knowledge
title: "Two attributions in the corpus-growth threshold finding are wrong, and one would have bought the wrong fix"
status: approved
priority: high
created: 2026-08-24
updated: 2026-08-24
tags: [oracle, false-oracle, diagnosis, attribution, corpus-growth, timing]
parent: KN-528
links:
  - {id: KN-527, type: relates-to}
  - {id: KN-525, type: relates-to}
---
# Two attributions in the corpus-growth threshold finding are wrong, and one of them would have bought the wrong fix

Measured 2026-08-24 on `main` at `ccb6ac33`, re-running the two failures that
`knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in` diagnosed. Its ENOBUFS half
is CONFIRMED verbatim (see below). Its timeout half names two mechanisms that do not exist.

## What that doc says, and what is actually true

> "Each runs `export-spec-mirror --check` TWICE over 1,646 mirror files, and every `--check`
> shells out to `lore list` per type."

Both halves are wrong, and its title's "a 2-second timeout margin" follows from them.

**(1) THREE runs per test, not two.** `scripts/tests/spec-mirror-export.test.ts:624` (HAPPY)
calls `runMirrorScript(["--check"])` as `baseline`, then `first`, then `second`. The NEGATIVE
test at :641 does the same — `baseline`, `firstCheck`, `secondCheck` — plus one
`measureLiveParity()` that itself shells out `lore list --type spec --json`.

**(2) `--check` NEVER shells out to `lore list`.** It runs IN-PROCESS against a real `App`:
`scripts/export-spec-mirror.ts:324` calls `app.exportDocsService.exportDocs({ projectDir,
dryRun: true, type })` in a loop over `MIRROR_TYPES`. There is no subprocess and no `lore
list` in the check path at all.

**Measured cost, unpiped:** `bun run check:spec-mirror` alone → `real 11.48s`, **EXIT=0**.
So each test spends 3 x 11.48 = **~34.4 s** against a 30 s `testTimeout`. The overrun is
~4.4 s, not the 1.7/2.1 s margin the doc computes from a two-run model.

## Why this mattered

`knowledge-handoff-agent-main-orchestrator-121` NS1, resting on attribution (2), proposed:
*"Field projection on `lore list` is the smallest change that also shrinks the two 30s
drift-check runs, since each `--check` shells out to `lore list` per type."*

⛔ Field projection cannot shrink those runs by one millisecond — they never call `lore list`.
The ENOBUFS failure and the two timeouts are INDEPENDENT defects needing two separate fixes:
one is payload size on a subprocess boundary, the other is an O(corpus) operation invoked
three times inside a fixed timeout. Acting on NS1 as written would have shipped a real fix for
failure 1, measured no improvement in failures 2 and 3, and left the cause unexplained again.

## What IS confirmed from the superseded diagnosis

Re-measured the same day, both hold exactly:

- knowledge payload is **22,275,853 bytes** against `runLore`'s `maxBuffer: 20 * 1024 * 1024`
  -> `status: null` + `error.code: ENOBUFS`.
- `runLore` returns `result.status ?? 1` and discards `result.error`, so the failure surfaces
  as `failed (exit 1)` with a COMPLETELY EMPTY stderr. Reproduced verbatim this session.
- The consumer reads `{id, slug}` only. Live per-type payloads: knowledge 21.24 MiB / 527 docs,
  task 8.3 MiB / 808 docs, spec 2.5 MiB / 155 docs — `task` is on the same growth curve and
  will cross the same wall.

## The generalisable lesson

⛔ **A timing failure's cause is not decidable from the failure message plus a plausible
mechanism — the invocation count and the call path must each be READ.** Both wrong
attributions here are of the same kind: a mechanism that would explain the symptom, asserted
without opening the call site. `--check` shelling out per type is entirely believable; the
loop body says otherwise in one line. Counting two runs is believable; the test body has three
`runMirrorScript` calls in plain sight.

This is the timing-domain twin of the already-recorded rule that a failing NUMBER must be
attributed by LINE and never by test title
(`knowledge-the-mirror-content-parity-oracle-is-structurally`). Same failure mode, different
instrument: there, the title was trusted over the line number; here, a plausible mechanism was
trusted over the call path.

## Decided fix direction (user decision, 2026-08-24)

- ENOBUFS -> field projection on `lore list` (`--fields`), so the oracle stops requesting
  ~370x the data it reads. Ships to consumers too: any corpus census hits this wall as the
  corpus grows.
- The two timeouts -> `--type` scoping on `export-spec-mirror --check`, so the test's cost
  matches its assertion's scope (it only ever asserts the `spec` line). ⛔ Requires first
  confirming the other five types' idempotency is covered by some other oracle, else this is a
  WEAKENING and must be re-baselined explicitly, not quietly.
- ⛔ Raising either constant is refused: both would be symptom fixes on a monotonically
  growing corpus.
