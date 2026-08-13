---
id: TASK-492
type: task
role: plan
title: "AC-IC-1 harness runs out of sampling budget under load while the contract itself holds"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-08-12
tags: []
parent: PRD-001
---
## Symptom

`packages/lore/tests/integration/cli/issue-report-concurrency.bun.test.ts` → `AC-IC-1` ("fifty runs only conforming outcomes") fails on `main` under moderate machine load:

```
line 363: expect(nonConforming).toEqual([]);        <- PASSES (zero contract violations)
line 364: expect(conformingShapes).toHaveLength(50) <- FAILS
          Expected length: 50
          Received length: 14
```

Measured by the orchestrator at load average 3.32 (8 cores), 3 pass / 1 fail, 102s runtime.

## What is and is not broken

**The concurrency contract itself is NOT violated** — `nonConforming` is empty, and that assertion runs first. Only 14 of 50 attempts produced a countable conforming outcome; the other 36 were dropped by the harness's own exclusion logic (`contention_outside_report_write` — consumer-corpus startup lock, i.e. contention outside the write path the AC governs).

So this is a **sampling-budget defect in the harness**, not a product defect: the exclusion rule is correct in what it excludes, but the run budget (`TARGET_RUNS = 50` attempts) does not survive a machine that is busy enough to make exclusions common.

## Provenance — pre-existing, and measurably improved by the libsql fix

Not introduced by `task-fix-the-spec-072-cross-corpus-database-is-locked-race`. That task's implementer ran the A/B: with its fix stashed and the binary rebuilt, this same harness produced **34 actual contract violations** (`nonConforming` non-empty) across ~80 attempts; with the fix restored, **0 violations**. The fix strictly improved contract conformance. What remains is the harness failing to *collect enough samples*, which the fix neither caused nor addresses.

Machine context at the time: 25-26 concurrent `bun` processes from sibling worktree agents.

## Constraints for the fix

- ⛔ Do NOT relax or delete the exclusion rule to inflate the sample count — excluded runs are excluded for a reason (they are not attributable to the governed write path). Inflating the count by counting them would make the AC lie.
- ⛔ Do NOT weaken `expect(nonConforming).toEqual([])`. That assertion is the actual contract and it currently passes; it must keep passing.
- Raise the attempt budget (attempts ≠ target samples: collect until `TARGET_RUNS` conforming samples exist, with a bounded attempt ceiling), or make the harness declare its own inconclusive state loudly when the ceiling is hit without enough samples. An `inconclusive` verdict that names the exclusion count is honest; a silent short count that fails a length assertion is not.
- Precedent for the "bounded sample-count increase, not a sleep/retry" shape: the sibling fix raised `MAX_ATTEMPTS` 5→20 in `issue-report-cross-corpus.bun.test.ts` for the same class of reason.

## Oracle

`cd packages/lore && bun test tests/integration/cli/issue-report-concurrency.bun.test.ts` must pass on 3 consecutive runs, at least one of them under concurrent load (start a few background `bun` processes, or run it while another test suite runs). Report the collected-sample count and the exclusion count for each run — a green run that collected exactly the minimum tells you nothing about headroom.

## Outcome 2026-07-31 — harness half LANDED, oracle NOT met, premise INVERTED

Merged at `549b2c8`. The harness now decouples attempts from samples (ceilings
`MAX_ATTEMPTS=800` / `SAMPLING_BUDGET_MS=300_000`, whichever first), prints a census on
EVERY run (collected / excluded-by-reason / attempts / elapsed), and turns the sample
itself into a reported verdict: `full` → exact-length assertion still runs; `degraded`
(≥ `MIN_CONCLUSIVE_RUNS` = 20) → loud green; `unmeasured` (< 20) → RED. The old
`excluded <= MAX_ATTEMPTS - TARGET_RUNS` cap is gone — it measured the wrong quantity
(exclusions scale with machine load, so it failed a busy host whose contract held).
`expect(nonConforming).toEqual([])` is unchanged and still runs first over every collected
sample. The suite timeout went DOWN, 900s → 600s.

**This task's premise is inverted by measurement.** The harness does not starve *under*
load — it starves when the machine is *idle*, and passes with headroom under load. Four
runs, perfectly bimodal, counts printed by the harness itself:

| Run | Load | Collected | Excluded | Attempts | Verdict |
|---|---|---|---|---|---|
| 1 | ambient ~3.9 | 12/50 | 788 | 800/800 | UNMEASURED — fail |
| 2 | +4 CPU workers | 50/50 | 58 | 108/800 | CONCLUSIVE — pass |
| 3 | ambient | 12/50 | 788 | 800/800 | UNMEASURED — fail |
| 4 | +4 CPU workers | 50/50 | 61 | 111/800 | CONCLUSIVE — pass |

Readable rate ~8% idle vs ~46% loaded. On an idle host both invocations of a pair start in
lockstep and collide on the shared consumer corpus's startup write; CPU contention staggers
them. Orchestrator independently reproduced the RED on unmodified `main` (12/50, 22.3s) —
this change did not introduce the red, it NAMED it.

## Still blocked — two product-side root causes, both outside this task's anchor

1. `task-the-concurrency-exclusion-classifier-excuses-governed-path` — of 300 attempts, 92
   excluded invocations carried an uncaught `database is locked` thrown from
   `openValidatedUpstream` / `report`, i.e. the GOVERNED path, excused only by
   `hasContentionOutsideReportWrite`'s stack-frame branch. Mechanism confirmed by source
   read at `packages/core/src/issue-report.ts:441`. This is a false-GREEN vector.
2. `task-openvalidatedupstream-lets-a-synchronous-store-init-throw` — the same 92 throws at
   their source: `toWriteContentionError` re-types only the `Result` path, while the store
   handle's `init` throws before any Result exists. Same class as `d5396cd`, which reached
   the readonly probe but not the full-store handle.

A third, deliberately NOT actioned: the pair shares ONE consumer corpus, so both
invocations' startup writes contend on a resource the contract does not govern — the
dominant exclusion source is a fixture artifact. Giving each invocation its own consumer
root (still one shared upstream, which is what "two concurrent invocations against ONE
upstream corpus" actually names) would remove the confound at its root, but that changes
what the fixture measures and needs its own decision.

**Do not close this task until AC-IC-1 is green on an IDLE host** — a green obtained only
under synthetic load is the same false oracle in the opposite direction. Re-verify the
attempt ceiling after (1) and (2) land: `MAX_ATTEMPTS=800` is sized for the post-fix ~33%
readable rate, and today it buys nothing (0 of the last 500 attempts of an 800-attempt run
were readable) while costing ~225s per failing run.

## Post-root-cause measurement 2026-07-31 @ `35ee2e6` — 3 consecutive GREEN, exclusions gone

Both blocking tasks landed and are archived:
`task-the-concurrency-exclusion-classifier-excuses-governed-path` (`c52f043`) and
`task-openvalidatedupstream-lets-a-synchronous-store-init-throw` (`35ee2e6`).

The second one's implementer found the task's premise HALF-WRONG by probing instead of
trusting it: the upstream handle did NOT lack the declared bound. It had it, but `init()`
issued `PRAGMA busy_timeout` THIRD — and `PRAGMA journal_mode = WAL` is the first statement
that touches the file, so it ran under bun:sqlite's default 0ms. Measured over 240
cold-open connections per arm: **24/240 throws armed-late → 0/240 armed-first**, with a
negative control (same hoist, bound = 0) still throwing **31/240** — so it is the DECLARED
BOUND armed early that fixes it, not the reorder. A second, independent defect: SQLite does
not consult the busy handler for a journal-mode SWITCH and any bound can expire, so
`buildUpstreamContext` was leaking exceptions past its own `Result` type; it now catches and
returns `err(STORE_ERROR)`, and a failed `init()` closes its own handle before re-throwing.

Orchestrator's own runs on `main` (counts printed by the harness, not narrated):

| Run | collected | excluded | attempts | elapsed |
|---|---|---|---|---|
| 1 | 50/50 | **0** | 50/800 | 15.8s |
| 2 | 50/50 | **0** | 50/800 | 14.6s |
| 3 | 50/50 | **0** | 50/800 | 14.1s |

AC-IC-2 control: 10/10 detected, 0 undetected, 0 excluded, 10/20 attempts.
Compare pre-fix on this same host: 12/50 collected, 788 excluded, 800/800 attempts, ~225s.
Exclusions did not merely fall — they went to ZERO, which no amount of machine-load
staggering ever produced (the best pre-fix regime still excluded 58–61).

Sibling suites re-verified green at the same commit: `issue-report-cross-corpus.bun.test.ts`
(AC-IC-5, 13 tests) — the classifier implementer had flagged it as at-risk from the
narrowing, and the service fix resolves it; `busy-timeout.bun.test.ts` (6);
`issue-report-service.test.ts` (14); `issue-concurrency-classifier.test.ts` (5);
`bun run typecheck`; `bun run check:no-timer-retry`.

### Why this task is STILL NOT closed

⛔ **The idle-host confirmation was NOT obtained.** All three runs above executed while
FOREIGN Claude Code sessions were driving large `bun test` batches on this machine from
their own worktrees (`.claude/worktrees/agent-ac20b149787e8c42f` and three siblings; ~125
concurrent bun/node processes; ambient load 7.2–8.8). Load is precisely the variable this
task's own measurements proved decisive, and high load is the regime that ALREADY passed
before the fix — so a green obtained under it, on its own, cannot discriminate.

The zero-exclusion count is strong mechanism-level evidence (no pre-fix regime, loaded or
idle, ever reached 0), and the mechanism predicts idle should now be FINE rather than worse
— collisions now WAIT on the native busy handler instead of throwing. But prediction is not
measurement. Re-run these three on a genuinely quiet host (ambient load < 2, no foreign
`bun` processes) before closing. Also re-evaluate `MAX_ATTEMPTS = 800` then: it is now
reached by nothing (50 attempts sufficed in all three runs), so its ~225s worst case is
no longer paid, but the constant was sized against a defect that no longer exists.

## Closing measurement 2026-08-12 @ `b8c115d6` — the load-matched control now exists

The blocker recorded above was "the idle-host confirmation was NOT obtained". It is now
obtained, and the criterion I wrote for it was WRONG in a way worth recording.

**The criterion was mis-specified.** I wrote "ambient load < 2, no foreign bun processes".
`< 2` was an arbitrary stand-in for "idle"; the number that actually discriminates is the
load at which this harness DEMONSTRABLY FAILED, which was measured twice: ambient **3.18**
(orchestrator's pre-fix run on unmodified `main`, 12/50 collected, 788 excluded) and ambient
**~3.9** (implementer's two failing runs, 12/50, 788 excluded, both 800/800 attempts). A
threshold below both of those is what proves discrimination; `< 2` merely made the criterion
harder to satisfy without making it more informative — and on this machine (two-plus
concurrent Claude sessions, five resident MCP servers) it was never going to be satisfiable,
which is how it survived 12 days unmet.

Three consecutive runs at `b8c115d6`, `dist/lore` rebuilt first (the root binary was stale by
~1.5h of commits — false-oracle vector 4), counts printed by the harness itself:

| Run | ambient load at start | collected | excluded | attempts | elapsed |
|---|---|---|---|---|---|
| 1 | 4.44 | 50/50 | **0** | 50/800 | 16.2s |
| 2 | 3.91 | 50/50 | **0** | 50/800 | 15.8s |
| 3 | **2.84** | 50/50 | **0** | 50/800 | 15.8s |

Run 3's ambient load is BELOW both measured failing loads, with zero foreign `bun test`
batches running (checked: `pgrep -f "bun test"` returned 0 before the sequence). Run 1 doubles
as the under-load arm. Six green runs now span ambient 2.84 → 8.82; exclusions are identically
zero at every point, with no degradation as load falls.

**The A/B control was already in hand and I had not recognised it**: 3.18 pre-fix → 12/50 with
788 exclusions, versus 2.84 post-fix → 50/50 with 0 exclusions. Same machine, same harness,
comparable load, opposite verdicts. That is the load-matched discrimination the "idle host"
phrasing was groping for.

**Independent hardening by another session, `a02ef284`**: `MIN_CONCLUSIVE_RUNS` is now
`TARGET_RUNS` (50), so the `degraded` band — a reduced sample reported as a loud GREEN — no
longer exists; a shortfall of any size is RED. That closes the residual concern recorded
above (a floor of 20 is weak protection when the exclusion rule itself can excuse governed-path
failures). The harness now reads `floor 50` in its census, and all six runs cleared it outright.

`MAX_ATTEMPTS = 800` is left alone: every run since the root-cause fix terminated at exactly
50 attempts, so the ceiling is never approached and its ~225s worst case is never paid. It is
now dead headroom rather than a cost, and the file has since been edited by another session —
churning the constant would buy nothing.

Both root-cause fixes verified still present at this commit: `sqlite-store.ts:218` issues
`PRAGMA busy_timeout` before `journal_mode` (:220), and `issue-report.ts` still carries
`GOVERNED_PATH_FRAME_TOKEN_PATTERNS` / `hasGovernedPathFrame`.
