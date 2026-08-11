---
id: TASK-429
type: task
role: plan
title: "Discharge D7 in code: the forced-contention control cannot exclude a startup-phase refusal (false RED), and the readable-run floor is set to the sample size AC-IC-1 rejects"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: SPEC-115, type: implements}
---
## Origin

`spec-report-issue-has-no-specified-concurrency-contract-ac-072` gained **D7** on 2026-08-01 (spec at v41, `approve` 0.76 with zero blocking questions, promoted via `lore approve`). D7 declares the contention-attribution contract that AC-IC-1 and AC-IC-2 previously left open. The spec was NOT bent to match the shipped harness — two obligations now stand unsatisfied, and this task discharges them.

Predecessor task `task-ic-spec-discharge-the-startup-write-contention-gap-ac-ic-1` covered the spec side only.

## What is already done — do NOT redo

Measured at source 2026-08-01, before this task was written:

- `classifyConcurrencyOutcome` (`packages/core/src/issue-report.ts`) ALREADY implements the startup-phase exclusion: `hasContentionOutsideReportWrite` → `not_attributable` / `contention_outside_report_write`, evaluated AFTER the two conforming shapes. Its unit suite already covers those rows. AC-IC-1's classifier half needs nothing.
- The 50-run harness already excludes-and-reports by reason (`issue-report-concurrency.bun.test.ts`).
- AC-IC-3's path-existence assertion is already live: `scripts/check-no-timer-retry.ts:263` computes `missing` via `existsSync` over D3's list and exits 2 as a loud precondition failure. The AC statement was edited to say what the checker already does — no code change.
- D3's three paths all exist (verified); D6's sibling-module option was not exercised (the classifier lives at `packages/core/src/issue-report.ts`, already in D3's list).

## Gap 1 — `ForcedContentionVerdict` cannot exclude a startup-phase refusal

`classifyForcedContentionOutcome` (same file) recognises only ONE exclusion reason:

```ts
export type ForcedContentionVerdict =
  | { outcome: "detected"; refused: 1 | 2 }
  | { outcome: "undetected"; detail: string }
  | { outcome: "not_attributable"; reason: "native_module_load_race"; detail: string };
```

Its body checks the declared loud failure, then the dlopen race, then both-exit-0, then falls through to `undetected` with "neither invocation produced the declared loud failure". A startup-phase refusal — exit 1 plus a generic `database is locked`, carrying neither the declared exit code 5 nor the declared template — lands in that final branch.

**That is a FALSE RED.** The external write transaction blocks the STARTUP write first, so the second invocation can die before the report write is ever attempted; the run never reached the contract, yet AC-IC-2 records the criterion failing. It is also INTERMITTENT — the startup write only contends when `CREATE TABLE IF NOT EXISTS` or `pruneExpired()` actually needs the write lock — which is why AC-IC-2 currently passes and this stayed invisible.

D7 forced-contention table **row 4** is the contract: neither invocation refuses loudly, either carries the locked-database message without the template → `not_attributable` / `contention_outside_report_write`, EXCLUDED, not counted toward the 10. Order matters and is part of the contract: a detected loud failure wins over BOTH exclusion reasons, because one declared refusal satisfies the criterion and a startup-blocked sibling cannot un-observe it.

## Gap 2 — the readable-run floor is set to the sample size the spec rejects

`MIN_CONCLUSIVE_RUNS = 20`, and at `degraded` sampling power the harness passes on the census banner alone. AC-IC-1's own rationale rejects 20: at the measured ~10% failure rate a 20-run harness misses the bug ~12% of the time. So a degraded pass lands at exactly the detection power the criterion exists to avoid — a false green wearing a banner.

D7's *Sampling power* clause resolves it in the spec: the floor EQUALS `TARGET_RUNS = 50`, there is no degraded-power pass, and fewer than 50 collected runs is a FAILURE as measured-nothing reported with the collected count and every exclusion reason. Exclusions stay unbounded in COUNT (they scale with machine load — capping the count reddens a busy host whose contract held) and bounded only by total effort: `MAX_ATTEMPTS = 800` and `SAMPLING_BUDGET_MS = 300000`, i.e. 16× headroom over 50 counted runs.

Keep the census banner — it is good diagnostics. What must change is that it stops being a verdict.

## Oracle

- Gap 1: a `classifyForcedContentionOutcome` unit row for D7 forced-contention table row 4 returns `not_attributable` / `contention_outside_report_write`. CONTROL rows proving the change is not over-broad: a declared loud failure alongside a startup-phase refusal still returns `detected`; both-exit-0 still returns `undetected`; a non-locked, non-dlopen double failure still returns `undetected`. Pure unit test, no spawn.
- Gap 1 e2e: the control harness excludes such a run and does not count it toward the 10, within the declared bound of at most 10 exclusions in 20 attempts.
- Gap 2: with fewer than 50 counted runs the AC-IC-1 test FAILS and its message names the collected count and every exclusion reason. CONTROL: 50 counted runs all conforming still passes. Simulate the shortfall by injecting classifier verdicts — do NOT try to induce it by loading the machine, which is unreproducible.
- Every row of BOTH D7 decision tables (10 + 6) is covered by AC-IC-6's unit suite; a mis-classified row must FAIL the suite (assert that by inverting one row, then reverting).
- RED-FIRST, recorded: write the row-4 and shortfall assertions first, run them against the current implementation, confirm RED, and record it with `lore evidence --oracle test --result expected-fail` (NOT `--result fail`: `expected-fail` is the vocabulary for a deliberate red, rendered `⚑R` instead of `✘`).

## Dispatch constraint

⛔ Do NOT run the AC-IC-1 harness concurrently with any other heavy suite. It spawns 100+ processes and is load-sensitive; a concurrent full-suite run produces phantom failures. Serialise.
