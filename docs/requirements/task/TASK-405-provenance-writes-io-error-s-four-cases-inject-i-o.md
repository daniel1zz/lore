---
id: TASK-405
type: task
role: plan
title: "provenance-writes-io-error's four cases inject I/O faults by unlinking an open SQLite file — a POSIX no-op, so the suite carries a 1-in-3 false RED"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-02
tags: []
parent: PRD-001
---
A full-suite verdict on a CLEAN tree at `154c1bd` came back with exactly one failure, and it is
not a regression — it is a test whose failure-injection technique cannot work reliably on POSIX.

## Measured 2026-08-01 by the orchestrator

Full suite, clean tree, named commit `154c1bd`: vitest 434 files / 7635 passed / 4 skipped, ALL
green. bun: 1737 pass, **1 fail**, 160 files, 488s.

The failure:

    tests/unit/store/provenance-writes-io-error.bun.test.ts:206
    "ERROR — softDeleteWithProvenance returns err(STORE_ERROR) instead of throwing
     when the backing file is deleted underneath it"
    expect(result.ok).toBe(false)   ->   Received: true

Re-run in isolation three times: **fail, pass, pass**. Non-deterministic.

## Root cause — `unlink` is not an I/O fault on POSIX

    function deleteBackingFiles(dbPath: string): void {
      for (const suffix of ["", "-wal", "-shm"]) unlinkSync(dbPath + suffix);
    }

Unlinking a file that a process already holds open removes the DIRECTORY ENTRY only. The inode
survives until the last descriptor closes, and SQLite's existing fd keeps reading and writing it
perfectly well. Whether a subsequent statement fails therefore depends on incidental state — whether
SQLite needs to reopen the file, WAL checkpoint timing, page-cache contents, whether `-shm` was
already mapped. None of that is under the test's control, so the assertion is a coin flip weighted
by machine load. The observed 1-in-3 rate is a property of the technique, not of a bug.

## Blast radius — one file, but FOUR cases, all on the same technique

`deleteBackingFiles` is called at lines 126, 150, 183, and 223 of that file (defined at 95, used
nowhere else in the repo). Only line 183's case failed in this run; the other three are equally
non-deterministic and have simply been winning the coin flip. ⛔ Do not fix only the case that
happened to fail — the defect is the shared technique.

## Why this earns a fix rather than a retry

A test that fails ~1 run in 3 with no code change is a FALSE RED. It costs more than noise: every
future full-suite verdict inherits an unexplained failure, and the standing repo lesson about clean
vs dirty trees ("same commit measured 20+ failures dirty vs 4 clean, all foreign RED") only works if
a clean tree is genuinely expected to be green. One tolerated flake trains the next reader to
discount a real red. ⛔ Never "fix" this by adding a retry, raising a timeout, or marking it skipped
without replacing the coverage — the underlying assertion (these methods return
`err(STORE_ERROR)` instead of throwing) is worth keeping.

## Required — pick a deterministic fault, justify it

Weigh at least these and say why the chosen one is deterministic on macOS AND Linux:

1. **Permission removal** — `chmod 000` the file/dir. Caveat to address explicitly: the owning user
   (and root) may still open it on some platforms, so verify rather than assume.
2. **Directory-level denial** — `chmod` the CONTAINING directory so SQLite cannot create/reopen
   `-wal`/`-shm`. Often more reliable than touching the db file itself.
3. **A seam** — inject a failing driver/connection double so the error is produced by construction
   rather than by coaxing the filesystem. Most deterministic; check whether `SQLiteStore`'s
   construction already permits it before adding new production surface for a test's benefit.
4. **A read-only connection or a full/immutable filesystem** — deterministic but heavier setup.

Whatever is chosen, route all four call sites through it — one helper, one technique.

## Oracle

- The load-bearing one: run the file **20 consecutive times**, 20/20 green. A single green run does
  not close a flake — this file already produced 2 greens in a row while broken.
- Assert the fault actually took effect, not merely that the assertion passed: the chosen technique
  must be shown to make the operation fail (e.g. the error surfaced is `STORE_ERROR` for the
  intended reason), with a control run WITHOUT the fault proving the same call succeeds. A fault
  that silently stopped being injected would turn all four cases green while testing nothing —
  this repo's fifth false-oracle face.
- REGRESSION: the four cases keep asserting what they assert today (`ok === false`,
  `error.code === "STORE_ERROR"`, and `thrown === undefined` — the never-throws contract from
  `task-fix-result-contract-gap-begin-immediate-issued-outside-try`).
- Run under load too: re-run the file while the full suite is running, since load is what tips the
  current coin flip.

## Provenance

Not a regression from this session's three merges (mixed-runner evidence guard, `test:changed`
rule (d), the attested-pass floor) — none of them touch `packages/lore/src/store/**` or file
lifecycle. Confirmed by mechanism, not merely by "the diff looks unrelated": the failure mode is
POSIX unlink semantics in the test's own helper, which predates all three.
