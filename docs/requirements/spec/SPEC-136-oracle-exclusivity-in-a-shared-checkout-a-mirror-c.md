---
id: SPEC-136
type: spec
role: spec
title: "Oracle exclusivity in a shared checkout: a mirror check that cannot repair itself, a pollution guard that sees mirror content, a gitignored probe namespace, and a serialized suite"
status: approved
priority: high
created: 2026-08-11
updated: 2026-10-10
tags: []
---
# Overview

Two Claude sessions share this one checkout, and the test suite has no isolation from either of
them or from itself. This spec makes the mirror oracle read-only (which simultaneously removes a
self-exempting assertion and stops the suite writing the live corpus), widens the pollution guard to
the content it currently cannot see, gives probe artifacts a gitignored home, and serializes
full-suite runs so a second one fails loud instead of interleaving.

Measured on `main` @ `6be150ef`, 2026-08-11.

## Problem

**One defect wearing two costumes (recorded as gap-ledger G19, and separately as a suite↔corpus
mutual exclusion).** `scripts/tests/spec-mirror-export.test.ts` establishes its baseline by running
the real exporter in WRITE mode — `const baseline = runMirrorScript([])` — and only then asserts
parity. That single line causes both of:

- **The invariant cannot fail.** The export *is* the repair. Count parity is asserted immediately
  after the thing that makes count parity true, so AC-FR-10a is structurally incapable of a red.
- **The suite writes the live corpus.** `.lore/export-index.json` and `docs/requirements/**` are
  dirtied on every run, which reds the NEXT run through the pollution guard below. A peer measured
  the mirror fingerprint moving `45ea1381` → `4c84f428` across one `bun run test`.

⛔ **G19's recorded scope is stale and must be corrected as part of this work.** The gap ledger
scopes it to "the PENDING mirror branch, NOT main as of 2026-08-11". Measured this session:
`git branch -a` lists only `main`, `git log --all --grep=a9f801dd` is empty — that branch does not
exist — and the repair-then-assert shape is present on `main`. The gap is OPEN on main and its
ledger entry points readers away from it.

**Nothing in AC-FR-10 requires the write.** Its text mandates only that the assertion run against
"THIS repo's PRODUCTION corpus (never a seeded fixture)": per-type file count equals the live corpus
count, every filename's leading id is byte-identical to its frontmatter `id:` zero-padded to 3
digits, and `links_broken === 0`. A read-only `--check` satisfies all three. The exporter call is
pure convenience, and it is what voids the oracle.

**The pollution guard is narrower than the pollution.**
`packages/lore/tests/integration/spec-loop-e2e.bun.test.ts:340-343` runs
`execSync("git status --short .lore", { cwd: REPO_ROOT })` and requires empty output. Because
`.gitignore` excludes `.lore/*` except `export-index.json` and `audit-anchor.json`, that check can
only ever see those two files — **mirror-content dirt under `docs/requirements/**` is invisible to
it entirely.**

**Probe artifacts have no safe home, and that cost a false red.** `.gitignore` declares no scratch
or probe namespace. The root `tsconfig.json` includes `scripts/**/*`; `packages/lore/tsconfig.tests.json`
includes `src/**/*` and `tests/**/*`. So any `.ts` file — hand-written probe or test fixture — dropped
inside one of those globs enters `bun run typecheck`'s scope. Measured 2026-08-11: a peer session's
deliberately-broken probe fixture, not gitignored, made this session's `typecheck` exit **2**; the
red was FALSE and a solo re-run was 7/7 clean. Attributing it to the diff under test cost real time.

⛔ **The recorded `exit 2` was RIGHT, and this spec's own first draft was wrong to "correct" it.**
That draft claimed `tsc --noEmit` exits **1** for a genuine compile error and **2** only for a
config-level fatal — a figure taken from a probe run through `bunx tsc`, which downloads its own
TypeScript into a temp lockfile rather than using the compiler this repo builds with. Re-measured
against `node_modules/.bin/tsc` (TypeScript 5.9.3), which is what `bun run typecheck` invokes:

| tsconfig shape | case | exit | error |
|---|---|---|---|
| `noEmit: true` | type error | **2** | `TS2322` |
| `noEmit: true` | empty include | **2** | `TS18003` |
| `noEmitOnError: true` + `outDir`, no `noEmit` | type error | 1 | `TS2322` |

Since every `typecheck:*` script passes `--noEmit`, **any** compile error in this repo exits 2. So
"exit 1 means it checked, exit 2 means it never did" is not merely wrong, it is **structurally
unavailable**: the discriminator between *checked and found errors* and *never checked* is the
**error code in the output** (`TS2322`/`TS1136` versus `TS18003`), never the exit code. The peer's
recorded observation stands. Two lessons ride on this: an oracle that reads "nonzero" as failure
still conflates a detection with a fatal — the same shape as a lint reverse-control placed outside
the linted tree, where the tool exits fatal and the rule never runs — and a single unverified probe
must never be allowed to overrule a recorded measurement, least of all a probe whose toolchain was
not the one under test.

**There is no concurrency guard of any kind.** No lockfile, no `flock`, no pid file, no
"already running" check anywhere in `package.json` or `scripts/**`. Two concurrent
`bun run test` invocations were measured interleaving in one checkout (peer pid 39206 at 15:32:06,
ours 58812 at 15:32:42), writing the same fixed paths.

## Decisions

- **D1 — no test may invoke the mirror exporter in write mode.** AC-FR-10's oracle drives
  `--check` (read-only) and FAILS on drift. This is the whole of G19's fix and it also ends the
  suite's corpus writes.
- **D2 — a direct consequence to state plainly: mirror staleness becomes a REAL failure.** Once the
  oracle stops repairing, any corpus write leaves the mirror stale until `bun run mirror:export` is
  run and committed. That is the intended behaviour of a drift check, and it makes re-export part of
  the corpus-write workflow rather than a courtesy. This spec must not soften D1 to avoid it.
- **D3 — the pollution guard widens to the content it is meant to protect**: `.lore/` AND
  `docs/requirements/**`, asserted both BEFORE and AFTER the suite so a run cannot pass by dirtying
  the tree only at the end. Its decision logic is EXTRACTED into a pure predicate
  (`packages/lore/src/repo-pollution-guard.ts` — path in, verdict + offending paths out) so both
  directions can be driven from a unit test without dirtying a real tree; the e2e guard becomes the
  wiring that feeds it `git status --short` output. On failure the predicate MUST return the
  offending paths and the guard MUST print them — a bare boolean reproduces the attribution cost
  this spec exists to remove.
- **D4 — probe and negative-control artifacts live in a gitignored `.scratch/` at the repo root**,
  which sits outside every tsconfig `include` glob. The convention is only real if it is asserted
  from both sides — but ⛔ **never by writing a broken file into a real typechecked glob**. Doing
  that reds every concurrent `typecheck` in the checkout for the duration, which is precisely the
  false red this spec exists to eliminate; an oracle that reproduces the defect in order to prove the
  defect is not acceptable. Instead: assert statically that `.scratch/` is gitignored AND matches no
  tsconfig `include` across all seven typecheck projects, and prove the compile-error discrimination
  in an ISOLATED temp project (own tsconfig, own `src`, `mkdtemp`). Same discriminating power, zero
  collision surface.
- **D5 — a checkout-level oracle mutex, with its path pinned.** `bun run test` acquires an advisory
  lock naming its pid; a second concurrent invocation exits **exactly 5** and prints the holder's
  pid, rather than interleaving. The lock lives at `git rev-parse --git-common-dir`, which the main
  checkout and every linked worktree SHARE — that is what makes it checkout-level and what makes it
  match the measured defect (two concurrent runs in ONE checkout). ⛔ A per-worktree lock path would
  compile, pass a naive test, and protect nothing. Conversely the TESTS must never touch that real
  path: they drive `main(lockDir)` with an injected `mkdtemp` directory, so a concurrent suite run
  elsewhere in the checkout cannot perturb the contention assertions. A stale lock (holder no longer
  alive) is reclaimed automatically — a mutex that can wedge the suite would be worse than none — and
  the stale case is constructed DETERMINISTICALLY, never by guessing an unused pid: spawn a trivial
  child, reap it, and write its now-certainly-dead pid into the lock.
- **D6 — a typecheck-based oracle MUST discriminate a DETECTION from a FATAL, and under `--noEmit`
  that discrimination is impossible from the exit code alone.** Both exit 2 (measured above). So every
  AC in this spec that reads `tsc`'s verdict asserts the EXACT exit code AND the expected **error
  code** in the output — `TS2322`/`TS1136` for a real finding, `TS18003` for "nothing was checked" —
  plus the offending filename. ⛔ Never assert merely "nonzero", and ⛔ never reshape a fixture into a
  `noEmitOnError` + `outDir` configuration in order to manufacture an exit 1: that would test a
  compiler configuration this repo never uses, satisfying the sentence while abandoning the property.
- **D7 — a drift detector that compares only the BODY is not a drift detector, and the routine and
  suite exporters MUST converge on one behaviour.** Measured on main 2026-08-13: `mirror:export
  --check` compares count and slug parity only ("file CONTENT is not compared"), `ExportDocsService`
  compares `canonicaliseBody` only ("blind to frontmatter by design"), and `check:spec-mirror`
  compares neither — so a `status` transition was invisible to all three while the vitest phase of
  `bun run test` silently rewrote exactly that field. The remedy documented elsewhere ("re-export and
  commit before the run") was therefore UNREACHABLE, not merely unreliable: no invocable command
  would write it. Frontmatter staleness now converges unconditionally, without `--force`, on the same
  rationale that already justified `identity_repaired`, and the report NAMES what it declines to
  repair rather than printing OK. ⛔ Fixing only the suite side would have made the mirror
  permanently unfixable instead of fixable-only-by-accident.
- **D8 — any corpus-wide census MUST source its population with `lore list --include-invalid`.**
  The default list silently omits invalidated docs while reporting a self-consistent total (1475 vs
  1495 measured 2026-08-13; per-type sums agree with the FILTERED total, so no internal check can
  catch it). A census built on the default produced an orphan-mapping count of 21 against a true
  value of 1 — a 21x error that reached this spec's own AC statement before being caught.

## Scope

- `scripts/tests/spec-mirror-export.test.ts` — D1
- `packages/lore/tests/integration/spec-loop-e2e.bun.test.ts` — D3's wiring (before + after)
- `packages/lore/src/repo-pollution-guard.ts` (new) — D3's pure predicate
- `packages/lore/tests/unit/repo-pollution-guard.bun.test.ts` (new) — AC-OX-2
- `.gitignore` — D4's `.scratch/` entry
- `package.json` — D5's lock wiring on the `test` script
- `scripts/oracle-lock.ts` (new) — D5's acquire/release/reclaim, with an exported `main` returning an
  exit code rather than calling `process.exit`, matching the armable shape the existing checkers use
- `scripts/tests/oracle-lock.test.ts` (new) — AC-OX-4
- `scripts/tests/scratch-namespace.test.ts` (new) — AC-OX-3
- `packages/lore/src/service/export-docs-service.ts` — frontmatter staleness generalised from
  identity-only (`id`/`parent`/`plan`/`links`) to the remaining scalar fields
  (`status`/`priority`/`title`/`tags`/`phase`), converging unconditionally; new
  `frontmatter_repaired`/`frontmatter_declined` report buckets — AC-OX-5
- `scripts/export-spec-mirror.ts` — no code change needed (`main`/`runExport` delegate to the fixed
  service, so `bun run mirror:export` with no flags already repairs status-only drift); carries a
  doc-comment stating this explicitly so the delegation is not mistaken for an omission — AC-OX-5
- `scripts/tests/mirror-frontmatter-drift.test.ts` (new) — AC-OX-5
- `scripts/tests/mirror-status-parity.test.ts` (new) — AC-OX-6

## Out of Scope

- The mirror's `human_id` two-writer disagreement and the `migrate ordinals` reversion loop — owned
  by `spec-mirror-identifier-ssot-one-writer-for-export-index-human`. ⛔ No task here may touch
  `packages/lore/src/service/ordinal-migration-service.ts`, `packages/core/src/ordinal.ts` or
  `packages/core/src/schemas.ts`.
- `runCheck`'s own byte-read-only assertion, which is AC-MIS-5 on that spec.
- Widening `lore status`'s drift checks or the pre-push hook.

## Acceptance Criteria

Attached via `lore ac add` as **AC-OX-1 … AC-OX-6**; that structured list is authoritative. The
id→mechanism mapping is normative:

- **AC-OX-1** (D1) — no test invokes the exporter in write mode, and the mirror oracle is a genuine
  drift check: a seeded drift makes it RED, and a full run of it leaves
  `git status --short .lore docs/requirements` empty. The detection oracle for the absence claim is
  named explicitly: a `grep -rn "runMirrorScript(\[\])"` over `scripts/tests` and
  `packages/lore/tests` must find nothing — write mode is defined as invoking the helper with no
  `--check` argument.
- **AC-OX-2** (D3) — the widened guard sees mirror-content dirt AND says where: the pure predicate
  rejects a `docs/requirements/**` line (the case the pre-change guard accepted), rejects a `.lore/`
  line, accepts empty, and RETURNS the offending paths on rejection; the e2e wiring names
  `docs/requirements` in its git invocation and runs the check both BEFORE and AFTER the suite.
- **AC-OX-3** (D4, D6) — `.scratch/` is gitignored AND matches no tsconfig `include` across all
  seven typecheck projects (static assertions), and the detection-versus-fatal discrimination is
  proven in an ISOLATED temp project using the SAME `--noEmit` shape the repo really uses: a broken
  `.ts` exits **exactly 2** with a real compile code (`TS2322`/`TS1136`) in the output, while an
  empty-include project also exits **exactly 2** but with `TS18003` and no real compile code.
  Nothing is ever written into a real typechecked glob.
- **AC-OX-4** (D5) — the mutex serializes and its path is checkout-level (`git --git-common-dir`,
  shared across linked worktrees), while its tests are hermetic (injected `mkdtemp` lock dir): with
  the lock held by a live pid a second acquire exits exactly 5 and prints the holder pid; with a lock
  naming a reaped child's pid it is reclaimed and exits 0; uncontended it exits 0.
- **AC-OX-5** (D7) — a status-only drift is BOTH detectable and repairable by an invocable command,
  proven on a THROWAWAY corpus with its own reverse control: the pre-change body-only comparison
  reports the same construction CLEAN, the repair converges to a byte-identical second run, declined
  files are NAMED, and the assertions drive the `scripts/export-spec-mirror.ts` entry point and
  `ExportDocsService` rather than a grep for a predicate's existence.
- **AC-OX-6** (D7 + D8) — the back-catalogue sweep, on the REAL tree, read-only: every mapped mirror
  file's frontmatter `status` equals its corpus doc's status, both coverage directions asserted
  (no orphan mapping, no unmapped live doc), with a POSITIVE parse-count trace equal to the
  mapped-and-present population, and the live-doc population sourced with `--include-invalid`.

## Sequencing Risks

- **D1 immediately turns this repo's own stale mirror into a red.** This session writes corpus docs,
  so the mirror WILL be stale when D1 lands. Re-export and commit before the post-merge full-suite
  run, and treat that ordering as part of the work rather than a surprise.
- **D3 will fail on any tree that is already dirty**, including dirt this spec's own tasks create.
  The guard must report the offending paths, never a bare boolean, or the next session pays the
  attribution cost this spec exists to remove.
- **D5's lock is itself a shared-state mechanism in a shared checkout.** Its failure mode must be
  fail-loud-and-reclaimable, never fail-closed: a wedged lock blocks all verification, which is
  strictly worse than the interleaving it prevents.
- **An earlier draft of AC-OX-3 had its reverse control write a broken file into a real typechecked
  glob — corrected before approval, and recorded here because the near-miss is instructive.** Even
  with `finally` cleanup and a unique filename, every concurrent `typecheck` in the checkout reds for
  the duration of that window: the spec would have manufactured its own motivating defect. D5's mutex
  would not have covered it either, since that lock guards `bun run test`, never a bare `typecheck`.
  The isolated-temp-project form has identical discriminating power and no shared-state window.


## Acceptance Criteria (structured)

- [⊘] [script] AC-OX-1: No test invokes the mirror exporter in WRITE mode anywhere under scripts/tests or packages/lore/tests, the AC-FR-10 oracle is a genuine drift check (a seeded drift makes it RED rather than being repaired first), and a full run of that oracle leaves git status --short .lore docs/requirements EMPTY
  script: test — ! grep -rn "runMirrorScript(\[\])" scripts/tests packages/lore/tests && bunx vitest run scripts/tests/spec-mirror-export.test.ts 2>&1 && test -z "$(git status --short .lore docs/requirements)" && echo "AC-OX-1 PASS: no write-mode exporter call in any test, drift oracle red on seeded drift, tree clean after the run"
- [⚑] [script] AC-OX-2: The repo-corpus pollution guard sees mirror content AND says where, with the wiring asserted from inside the unit suite: the pure predicate REJECTS a git status --short line under docs/requirements (the case the pre-change guard accepted), REJECTS a .lore line, ACCEPTS empty output, and RETURNS the offending paths on rejection rather than a bare boolean; and the unit test READS the e2e file and asserts it invokes git status --short .lore docs/requirements with the guard wired at FILE scope for both before and after (not nested in a describe — the pre-change guard's it() never actually ran before despite its name). REVISION RECORD (2026-08-11, in-flight): the original command paired a grep against the e2e file with a bun test of the unit file; attested verify returned result=inconclusive with 'ran 1 of 2 declared paths' at exit 0, because SPEC-061's completeness guard counts every test-file-shaped argv token in the command. This is a CORRECTION not a weakening: the grep assertion survives verbatim, moved inside the suite as a real test case, so it now also runs under bun run test while the command declares exactly one path and the completeness guard can reach a verdict
  script: test — bun test packages/lore/tests/unit/repo-pollution-guard.bun.test.ts 2>&1 && echo "AC-OX-2 PASS: predicate rejects mirror-content dirt with offending paths, accepts a clean tree, and the e2e wiring names docs/requirements at file scope both before and after"
- [⚑] [script] AC-OX-3: The probe-isolation contract is asserted WITHOUT writing into the shared checkout: (a) git check-ignore confirms .scratch is ignored, and a static assertion proves .scratch matches no tsconfig include glob across all seven typecheck projects; (b) in an ISOLATED temp project using the SAME --noEmit shape bun run typecheck actually uses, a broken .ts exits EXACTLY 2 with a real compile code in the output (TS2322 or TS1136), while an EMPTY-include project also exits EXACTLY 2 but with TS18003 and no real compile code. CORRECTION (2026-08-11): an earlier version pinned exit 1 for the compile error and treated exit 2 as the config-fatal marker. Re-measured against this repo's node_modules/.bin/tsc 5.9.3: under --noEmit BOTH cases exit 2; exit 1 appears only under noEmitOnError + outDir with no noEmit, which bun run typecheck never uses. So the checked-vs-never-checked discriminator is the ERROR CODE IN THE OUTPUT and an exit-code comparison provably cannot make it — do NOT reshape the fixture to manufacture a 1. ⛔ No part of this oracle writes a broken file into a real typechecked glob: doing so reds every concurrent typecheck in the checkout, the exact false red this spec exists to eliminate
  script: test — git check-ignore -q .scratch/probe.ts && bunx vitest run scripts/tests/scratch-namespace.test.ts 2>&1 && echo "AC-OX-3 PASS: .scratch ignored and matched by no tsconfig include; under --noEmit a real compile error and an empty include BOTH exit 2 and are separated by TS2322/TS1136 vs TS18003 in the output"
- [⚑] [script] AC-OX-4: The oracle mutex is CHECKOUT-level and its tests are hermetic. Production lock path resolves to git rev-parse --git-common-dir, which is shared by the main checkout and every linked worktree, so two runs anywhere in one checkout contend (a per-worktree lock would not satisfy the measured defect). The tests never touch that real path: they drive main(lockDir) with an INJECTED mkdtemp directory, matching the root-injectable shape of the existing checkers. Asserted: uncontended acquire exits 0; acquire while a LIVE holder pid owns the lock exits EXACTLY 5 and prints the holder pid; acquire against a lock naming the pid of a child the test itself spawned and REAPED reclaims it and exits 0, so the mutex can never wedge verification. main() returns the exit code and never calls process.exit
  script: test — bunx vitest run scripts/tests/oracle-lock.test.ts 2>&1 && echo "AC-OX-4 PASS: uncontended 0, live-holder contention exactly 5 naming the pid, stale lock reclaimed to 0"
- [⚑] [script] AC-OX-5: A status-only mirror drift is BOTH detectable and repairable by an invocable command, asserted on a THROWAWAY corpus with its own reverse control (⛔ never this repo live .lore). (a) DETECTION: after a seeded doc transitions draft->archived with its body byte-unchanged, the drift check REPORTS that file with a nonzero verdict, and the SAME construction is shown to be reported CLEAN by the pre-change body-only comparison — without that control the test cannot distinguish a working detector from one that reports everything. (b) REPAIR: an invocable command rewrites the frontmatter so a re-run reports clean, and a SECOND run is a byte-identical no-op (hash equality), so the repair is convergent rather than merely mutating. (c) HONEST REPORT: the drift report NAMES every file it declines to repair instead of printing OK, asserted by a case the repair deliberately declines — a report that can only print OK is the defect this AC exists to kill. (d) PRODUCTION WIRING (live call sites, not implementation existence): the test drives the scripts/export-spec-mirror.ts entry point and ExportDocsService, because a grep proving a new frontmatter predicate exists would pass while mirror:export still refuses the write — the exact false green measured on main 2026-08-13, when all three of mirror:export --check, lore export-docs --force and check:spec-mirror printed OK against 202 status-drifted files.
  script: test — bunx vitest run scripts/tests/mirror-frontmatter-drift.test.ts 2>&1 && echo "AC-OX-5 PASS: on a throwaway corpus a status-only drift is reported nonzero where the body-only control reports clean, the repair converges to a byte-identical second run, declined files are named rather than swallowed, and the assertions drive the export-spec-mirror entry point and ExportDocsService rather than a grep"
- [⊘] [script] AC-OX-6: BACK-CATALOGUE SWEEP, same slice as AC-OX-5 because a newly-sighted detector retroactively invalidates every file it could not previously see. On the REAL tree: every mirror file frontmatter status equals its corpus doc status, resolved through .lore/export-index.json mappings, never by filename (filenames are truncated and carry no slug). BOTH directions asserted: every mapping resolves to a live doc, every live doc has a mapping. READ-ONLY — the run leaves git status --short docs/requirements .lore EMPTY. ⛔ MUST state a POSITIVE trace: the count of files whose status line it actually parsed, asserted non-zero AND equal to the mapped-and-present population — a comparison that silently parses zero files is indistinguishable from a clean one (measured: a first attempt returned 0 mismatches while parsing 0 of 1490 files). ⛔ MUST source its live-doc population with `lore list --include-invalid`. CORRECTED BASELINE 2026-08-13 (statement only; --command BYTE-UNCHANGED, no assertion relaxed): the original pinned "202 of 1470 files" and "21 orphan mappings". Both came from a census on default `lore list`, which SILENTLY omits invalidated docs while reporting a self-consistent total — 1475 default vs 1495 with --include-invalid (knowledge 436->453, task 725->728), and the per-type sums agree with the filtered total, so every internal check passes. True orphan count is 1, not 21 (a 21x error), and the status figure was computed over a population missing those same 20 docs. The terminal assertion never depended on either number. This STRENGTHENS the criterion by making the population source explicit — an oracle without that flag reads clean over an incomplete population, the exact defect this AC exists to prevent, reproduced in its own author measurement. Known-red at correction time, deliberately left asserted rather than excused: exactly ONE orphan, KN-025, whose doc carries deleted_at 2026-07-18 — a soft-deleted doc still holding a mirror file and an index mapping.
  script: test — bunx vitest run scripts/tests/mirror-status-parity.test.ts 2>&1 && test -z "$(git status --short docs/requirements .lore)" && echo "AC-OX-6 PASS: every export-index-mapped mirror file frontmatter status equals its corpus status, the parsed-file count is asserted non-zero and equal to the mapped-and-present population so a zero-parse run cannot read as clean, orphan mappings are accounted for, and the read-only comparison left the tree unchanged"
- [⚑] [script] AC-OX-7: PRODUCTION LOCK PATH, split out of AC-OX-4 on 2026-08-17 because that criterion prose promises TWO layers while its oracle drives only one. AC-OX-4 asserts lock BEHAVIOUR (uncontended 0, live-holder 5, stale reclaim) against an INJECTED mkdtemp dir and explicitly states the tests never touch the real path; nothing therefore asserts its other promise, that the production path is CHECKOUT-level. Measured 2026-08-17: scripts/tests/oracle-lock.test.ts injects a dir on every call and its own header says resolveDefaultLockDir is exercised only by actually running bun run test for real, never by that file, so a per-worktree lock would pass all seven existing cases while protecting nothing. This AC closes that gap. Asserted, HERMETICALLY, inside a mkdtemp throwaway git repo (git init plus a real linked worktree via git worktree add) and NEVER against this repo live checkout: (a) the EXPORTED resolveDefaultLockDir is CALLED (production wiring, not a reimplementation of its logic and not a grep proving it exists) and its return value equals an independently computed git rev-parse --git-common-dir resolved to an absolute path; (b) THE DISCRIMINATING ASSERTION: resolveDefaultLockDir invoked with the linked worktree as repoRoot returns the SAME absolute directory as when invoked with the main checkout as repoRoot. Clause (b) is the whole criterion, because a main-checkout-only assertion is provably NOT discriminating: measured on this repo, git rev-parse --git-dir and git rev-parse --git-common-dir BOTH print .git from the main checkout and diverge only from a linked worktree. (c) The declared falsifier below turns --git-common-dir into --git-dir, the exact per-worktree shape this criterion exists to reject, and MUST make the command exit 1.
  script: test — bunx vitest run scripts/tests/oracle-lock-checkout-scope.test.ts 2>&1 && echo "AC-OX-7 PASS: the exported resolveDefaultLockDir was called and returned one identical absolute git-common-dir from both the main checkout and a linked worktree of a throwaway repo, so the oracle mutex is checkout-level rather than per-worktree"

## Code anchors

- scripts/tests/spec-mirror-export.test.ts
- packages/lore/tests/integration/spec-loop-e2e.bun.test.ts
- packages/lore/src/service/export-docs-service.ts
- scripts/export-spec-mirror.ts
- scripts/export-spec-mirror-core.ts
- scripts/oracle-lock.ts
- scripts/tests/mirror-status-parity.test.ts
- scripts/tests/mirror-frontmatter-drift.test.ts
- scripts/tests/mirror-prune-retire-deleted-doc-mapping.test.ts
- scripts/tests/oracle-lock.test.ts
- packages/lore/tests/unit/repo-pollution-guard.bun.test.ts
