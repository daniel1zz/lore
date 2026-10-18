---
id: SPEC-115
type: spec
role: spec
title: "report-issue has no specified concurrency contract: AC-072-9 asserts an assumed one and flakes at ten percent on every tree"
status: deprecated
priority: medium
created: 2026-07-31
updated: 2026-10-17
tags: []
---
## Overview

`AC-072-9` asserts that two concurrent `lore report-issue` invocations against one upstream corpus both exit 0. Nothing in `report-issue`'s contract says whether concurrent invocations are supported at all — the test encodes an unspecified behaviour as a requirement, and fails roughly one run in ten.

Goal: SPECIFY the concurrency contract, then enforce it so the observable outcome is deterministic. A nondeterministic gate is worse than a strict one: it teaches every reader to re-run instead of to read.

## Measured Gap

| tree | runs | failures |
|---|---|---|
| `17c1a44` (before the motivating slice's first commit) | 10 | 1 |
| `8227dd1` (slice fully merged) | 9 | 1 |
| `8227dd1`, this session's full suite | 1 | 0 |

Same ~10% rate on both trees, so the flake is PRE-EXISTING — a plausible hypothesis (that a new best-effort `gate_not_applicable` audit row added write contention) was FALSIFIED by the baseline measurement rather than reasoned away.

The failure: `issue-report-cross-corpus.bun.test.ts` → "2 concurrent CLI invocations", failing at `expect(r1.exitCode).toBe(0)` with `Received: 1`.

Recorded sample-size trap: an initial 4/4 green on the baseline looked like proof of innocence, but 0 failures in 4 runs is consistent with a rate as high as ~40%. Attribution of a flaky failure needs a measured rate on BOTH trees.

## Scope

In scope:
- Determine, with evidence, HOW the concurrent write actually fails (which layer refuses, and with what error) — this is the first task, and the mechanism choice below cannot honestly be made before it.
- Specify the contract and enforce it.
- Rewrite `AC-072-9`'s test to assert the SPECIFIED contract rather than an assumed one.

Out of scope, deliberately and emphatically:
- Any retry, backoff, or sleep added to make the assertion pass. That converts a specification gap into invisible latency, and the next reader cannot tell a slow success from a contended one.
- Reducing the failure rate by timing adjustments without specifying anything.

## Options Considered

The choice between 1 and 2 requires one specific fact this spec does not yet have: which layer refuses the second writer, and whether the observed `exitCode: 1` is a `SQLITE_BUSY`-class contention error or a higher-level validation failure. Task 1 produces that fact; the mechanism is then chosen on evidence, not on preference.

| # | Option | Shape | Cost of being wrong |
|---|---|---|---|
| 1 | Documented single-writer boundary, failing LOUD | The loser exits with a specified non-zero code and stderr naming the contention plus the command to retry | If the real use case is genuinely concurrent (multiple live agent sessions — which this repo's own workflow produces), a loud refusal pushes the coordination cost onto every caller |
| 2 | Genuine serialization at the store edge | A DECLARED, bounded wait (advisory lock or an explicit busy-timeout), documented as part of the contract | A bounded wait is indistinguishable from a hidden retry unless the bound is declared AND surfaced on timeout; if it degrades silently it becomes exactly the anti-pattern this spec forbids |
| 3 | Declare concurrency unsupported, make the test single-writer | Cheapest; deletes the scenario | Leaves real concurrent sessions with today's nondeterministic failure and no diagnostic — the defect survives with its only witness removed |

Option 3 is rejected outright: removing the witness is not fixing the defect.

## Design Decisions

- **D1 — Evidence before mechanism.** The first task records which layer refuses and with what error class, AND writes the resulting contract — the literal exit code plus the stderr message template — into this spec's Contract Details via `lore set`. No implementation commit lands before that write. This keeps the ACs self-contained: they reference a template that exists in the spec by the time anything is built, rather than a decision still in someone's head.
- **D5 — The failure message template is fixed in shape even before its wording is chosen.** It must carry a source field naming the contending session, PID or host, or the literal `unknown-source` when that cannot be resolved — a message that names nothing is never conforming — plus a retry command line. Without the `unknown-source` literal, 'name the contender when available' is unfalsifiable: any nameless message could be defended as 'not available'.
- **D2 — The observable invariant is mechanism-agnostic** and is what the ACs pin: for two concurrent invocations, the outcome is EITHER both succeed, OR the loser fails with the specified code and an actionable message naming the contention. A bare generic failure is a defect under either mechanism.
- **D3 — No timer-based retry in the enforcement path.** Enforced structurally, not by review. The search target is fixed here so it cannot be narrowed after the fact to whatever file happens to be clean: `packages/core/src/issue-report.ts`, `packages/lore/src/adapters/cli/commands/report-issue.ts`, `packages/lore/src/service/gh-runner.ts`, `packages/lore/src/service/github-intake-port.ts`, and `packages/lore/src/service/issue-resolution.ts` must together contain zero `setTimeout` / `sleep` / `backoff` occurrences. If the enforcement lands in a NEW module, that path is appended to this list by the same commit — never substituted for one of them. **The checker MUST assert that every path in this list exists and fail loud when one is missing**: a grep over a path that is not there returns zero matches, which is indistinguishable from a clean file (see Contract Details — this list shipped a nonexistent path and AC-IC-3 would have passed while measuring nothing).
- **D6 — The conforming/non-conforming decision is a PURE classifier**, `packages/core/src/issue-report.ts` (or a sibling pure module in `@lore/core`), consuming a pair of `{exitCode, stderr}` and returning the D2 verdict. The 50-run harness calls it rather than re-implementing the rule inline, so the decision table is unit-testable without spawning anything and an e2e harness can never quietly disagree with the contract it is supposed to enforce.
- **D7 — A run that did not measure two competing report-writers is EXCLUDED, never counted, and never silently.** The verdict vocabulary carries a third outcome alongside conforming and non-conforming: `not_attributable`, which is neither pass nor fail. Exclusion is decided by the D6 pure classifier, never by a harness-side special case, so the rule is unit-testable with no spawn. Two reasons are recognised, one per non-`report-issue` contention source named in Contract Details: `native_module_load_race` (the compiled-binary dlopen race) and `contention_outside_report_write` (a locked-database refusal from a layer that is not the report write — in practice the startup-phase corpus write in `buildAppFromSqlite`). Exclusions are unbounded in COUNT (they scale with machine load, so capping the count reddens a busy host whose contract held) but bounded by total effort, and the COUNTED sample must still reach its full declared size — there is no reduced-sample pass. Full statement of the rule, both enumerated decision tables (10 rows for the D6 classifier, 6 for the forced-contention control), the evaluation-order requirements and the sampling-power resolution: §Contention Attribution — D7, at the end of this document.
- **D4 — If option 2 is chosen, the wait bound is declared in config and surfaced on expiry** — a wait that expires must produce D2's actionable failure, never a silent partial write.

## Acceptance Criteria

**The declared criteria are the SSOT and are NOT restated here.** Read them with `lore ac list spec-report-issue-has-no-specified-concurrency-contract-ac-072`, or the §Acceptance Criteria (structured) block that `lore get` renders. This section carries only the SIZING AND SHAPE RATIONALE — the *why* that a one-line statement cannot hold. Six criteria are declared: AC-IC-1..AC-IC-6.

A prose copy of the statements lived here until 2026-08-01 and had already gone stale: it listed five criteria (AC-IC-6 missing entirely) and its AC-IC-1/AC-IC-2 wording predated D7's exclusion rule, so the two lists encoded DIFFERENT pass conditions for the same ids. `lore review` caught it and asked which was authoritative. Two AC lists in one document is the defect; the declared set wins, and this section stops duplicating it.

Rationale per criterion:

- **AC-IC-1 — HAPPY, determinism at a rate that can actually see the bug.** 50 runs, because at the measured ~10% failure rate a 20-run harness misses the bug ~12% of the time. This sizing is the criterion, not a preference: see D7's *Sampling power* clause, which resolves it against the shipped floor rather than deferring it.
- **AC-IC-2 — NEGATIVE, the control that proves the harness can detect the failure at all.** Contention is FORCED by holding an open write transaction, not by merely overlapping two writers: under Option 2 (declared bounded wait) overlapping writers legitimately resolve to both-succeed, which would prove nothing. The first invocation's status is deliberately unconstrained because the externally-held lock blocks it too — pinning it would encode the fixture's mechanics rather than the contract. Both-succeed fails the criterion: it shows the fixture never created contention.
- **AC-IC-3 — STRUCTURAL, mechanizes the D3 ban** rather than leaving it to review, and reads its path list from the spec so the target cannot be narrowed after the fact.
- **AC-IC-4 — ERROR, actionability.** Asserted by string or regex match, never by reviewer judgment. The `unknown-source` literal is what makes "name the contender when available" falsifiable (D5).
- **AC-IC-5 — REGRESSION**, against the specific unconditional `expect(r1.exitCode).toBe(0)` that hid this contract gap in the first place.
- **AC-IC-6 — the classifier is an AC, not only a design decision.** D6 alone would leave nothing forcing the classifier to be pure, spawn-free and table-tested; AC-IC-6 is what makes D6 falsifiable, and D7's two enumerated decision tables are the rows it must cover.

## Contract Details

Produced by `task-t1-evidence-which-layer-refuses-the-second-concurrent` (actor `agent:ic-t1-concurrency-evidence`, 6 recorded evidence entries, 2026-07-31), then written here by the orchestrator, since an implementer never edits corpus documents.

**Provenance split — read this before trusting any number below.** The refusing layer, the error class, the exit-code precedent, the two path defects and the startup-write contention source were each re-verified AT SOURCE by the orchestrator before being written here. The run-rate figures (147 of 150 natural runs serialising; the dlopen-race rate) rest on T1's recorded evidence alone and were NOT independently re-measured.

**Refusing layer — L2, the upstream write.** `SQLiteStore.insertWithProvenance` (`packages/lore/src/store/sqlite-store.ts`): `this.db.run("BEGIN IMMEDIATE")`, which carries its own try/catch and returns `wrapStoreError(e)`. The refusal comes from SQLite itself, not from any validation path.

**Error class.** `SQLiteError`, `code = SQLITE_BUSY`, `errno = 5`, message `database is locked`, surfaced at ≈2005 ms — the expiry of `PRAGMA busy_timeout = 2000` (`sqlite-store.ts:134`, set per SPEC-078 D9). `wrapStoreError` maps it to `STORE_ERROR`. This settles the question Options Considered left open: **the failure is CONTENTION, not validation.**

**Declared exit code: 5.** The code observed today is `1` (the generic `STORE_ERROR` mapping). `5` is already this codebase's write-contention family — `STALE_VERSION` and `CLAIM_CONFLICT` both map to it in `packages/lore/src/adapters/cli/utils.ts`, under the recorded reason *"someone else won the race, re-read and retry"*. A contended `report-issue` is that same class, so it joins the existing code rather than minting a new one.

**Declared stderr template.** Today's message is `Error: Storage failure: database is locked` — no source field, no retry line, therefore NON-CONFORMING under D5 and AC-IC-4. The declared replacement carries all three required parts:

```
Error: report-issue could not write to <corpus-path>: another writer held it longer than the declared <bound>ms bound.
Contending source: <session-id | pid | host>
Retry: <the exact command line to re-run>
```

`Contending source:` carries the literal `unknown-source` when the contender cannot be resolved — per D5 that literal is what makes "name the contender when available" falsifiable.

**Mechanism: Option 2 — declared bounded wait.** Chosen on the measurement, not on preference: the bounded wait ALREADY EXISTS (`busy_timeout = 2000`) and already serialises the large majority of natural concurrent runs. Option 1 would discard a working serialisation and push coordination onto every caller. Per D4 the bound moves into config and is surfaced verbatim on expiry.

**Two contention sources the T2 harness must account for.** Neither belongs to `report-issue`, and neither may be "handled" with a retry, a sleep, or a raised timeout — D3 forbids exactly that:
- **Every `lore` command writes its own corpus at startup.** `buildAppFromSqlite` (`packages/lore/src/app.ts`) constructs `new SessionStore(db)` unconditionally, and that constructor runs `db.exec(CREATE_TABLE_SQL)` followed by `pruneExpired()` — two writes against the same file as the corpus, before the command does anything the caller asked for. Two concurrent invocations therefore contend at STARTUP, not only at the report write. Any harness that attributes a startup-phase refusal to the report-write contract is measuring the wrong thing.
- **A dlopen race on the compiled binary**, measured by T1 at a rate high enough to redden a 50-run harness on its own. AC-IC-1's 50 runs must distinguish it from a contract violation, or the harness reports a false RED.

**Two path defects found and corrected here.** D3's list named `packages/lore/src/adapters/cli/report-issue.ts`, which does not exist — the real surface is `commands/report-issue.ts`. That one was SILENT: a grep over a missing path returns zero matches, so AC-IC-3 would have passed having measured nothing, which is why D3 now requires the checker to assert path existence. AC-IC-5 named `tests/integration/cli/issue-report-cross-corpus.bun.test.ts`; the file lives at `tests/unit/service/issue-report-cross-corpus.bun.test.ts`. That one was LOUD — `bun test` against a missing path exits 1 reporting "filters did not match any test files" — but it is corrected for the same reason.

**D3's path list is corrected and complete — re-verified at source 2026-08-24, all five paths exist**: `packages/core/src/issue-report.ts`, `packages/lore/src/adapters/cli/commands/report-issue.ts`, `packages/lore/src/service/gh-runner.ts`, `packages/lore/src/service/github-intake-port.ts`, `packages/lore/src/service/issue-resolution.ts`. The nonexistent path named above was replaced by the real surface before AC-IC-3 ever ran, so AC-IC-3's fail-loud existence assertion has no missing path to trip on.

**RE-BASELINE 2026-08-24 — D3's list lost one path and gained three. Recorded explicitly because editing an oracle's declared scope after it goes red is indistinguishable, in an audit, from weakening it.**
- **Command**: `bun scripts/check-no-timer-retry.ts`, run from a clean main checkout at `861bb4c8`, exit code measured unpiped (`> /tmp/ntr 2>&1; echo $?`).
- **Exact failure**: `EXIT=2` — *"D3 declares 1 path(s) that do not exist: packages/lore/src/service/issue-report-service.ts — a grep over a missing path returns zero matches, which is indistinguishable from a clean file, so this is a hard failure"*. The same red surfaced through vitest as 2 failures in `scripts/tests/check-no-timer-retry.test.ts`.
- **Why this is a correction and not a weakening**: that service file was **deleted** by `plan-land-the-github-intake-defect-channel-runner-cap-removal` (cap removal took the six cap symbols and their 1214 lines of tests with it). A path that no longer exists cannot be scanned, and D3's own fail-loud clause is what refused to pretend otherwise. Removing it ALONE would have narrowed the list to two entries and tripped `MIN_DECLARED_PATHS = 3` in `scripts/check-no-timer-retry.ts` — the parse-narrowing guard — so the removal is paired with the append D3 already mandates for successor modules. The three appended paths are where that service's enforcement responsibility actually landed, and each was **measured** clean before being pinned: `grep -cE "setTimeout|sleep|backoff"` returns 0 for all three, and 0 for both surviving paths. Net effect: the scanned surface grew from 3 declared paths (one of them unscannable) to 5 real ones. ⛔ The list must never again be narrowed to make a red go away — a path leaves only when its file is gone, and only together with its successor.


**D6's sibling-module option was NOT exercised, so D3's list needs no append.** D6 permits the pure classifier to live either at `packages/core/src/issue-report.ts` or in "a sibling pure module in `@lore/core`". It landed at the FIRST of those — `classifyConcurrencyOutcome` is exported from `packages/core/src/issue-report.ts`, which is already the FIRST entry in D3's list (it was the second until the 2026-08-24 re-baseline above removed the deleted service file that had preceded it). Had the sibling option been taken, D3 requires that new path to be APPENDED to the list by the same commit, never substituted for an existing one, and AC-IC-3 would then assert existence over six paths rather than the five it asserts today.

## Contention Attribution — D7

Written 2026-08-01, discharging the gap `lore review` found: the section above requires the harness to "account for" two non-`report-issue` contention sources and D3 forbids the obvious mitigations, but no rule said what accounting is permitted, and AC-IC-1/AC-IC-2 as originally worded classified an unattributable run as a criterion failure.

**D7 — A run that did not measure two competing report-writers is EXCLUDED, never counted.** The verdict vocabulary carries a third outcome alongside conforming and non-conforming: `not_attributable`, which is neither pass nor fail. Exclusion is decided by the D6 pure classifier, never by a harness-side special case, so the rule is unit-testable with no spawn and an e2e harness cannot quietly disagree with it. Two reasons are recognised, one per contention source named above:

- `native_module_load_race` — the compiled-binary dlopen race.
- `contention_outside_report_write` — a locked-database refusal raised by a layer that is not the report write, in practice the startup-phase corpus write (`buildAppFromSqlite` → `new SessionStore(db)`).

Its signature is mechanically checkable and does not require the classifier to observe execution phase: the declared contract failure is exit `5` AND the declared three-part template, so a locked-database refusal that carries neither is by construction not the report write. The inference is closed from the other side by AC-IC-4, which pins that a genuine report-write contention DOES carry the template — a refusal that bypassed the declared mapping would redden AC-IC-4 loudly rather than being silently excused here.

**Exclusion is bounded and reported, not silent — and the two harnesses bound it in DIFFERENT SHAPES, deliberately.** Unbounded exclusion is a false-green path: a criterion that excuses every run it cannot classify measures nothing while exiting 0. Every harness MUST therefore report each excluded run with the classifier's own reason, and MUST carry a declared numeric bound. The bound is not the same kind of number in both places:

- **AC-IC-1's 50-run harness bounds exclusion by a FLOOR on contract-readable runs, never by a cap on excluded ones.** A cap on the exclusion COUNT was tried and is wrong: exclusions scale with MACHINE LOAD, so a count cap reddens a busy host whose contract held perfectly. What actually has to hold is that enough runs stayed readable. Exclusions are therefore unbounded in COUNT and bounded only by total effort — `MAX_ATTEMPTS = 800` attempts and a `SAMPLING_BUDGET_MS = 300000` budget, i.e. 16× headroom over the 50 runs that must be collected.

**Sampling power — the floor IS the sizing, and a short sample never passes.** The readable-run floor equals `TARGET_RUNS = 50`, not a smaller number. This resolves the contradiction `lore review` raised on 2026-08-01 rather than deferring it: §Acceptance Criteria's rationale rejects 20 runs as underpowered (~12% miss rate at the measured ~10% failure rate), so a floor of 20 would let a pass land at exactly the detection power the criterion was built to reject — a false green wearing a census banner. The two claims cannot both stand, and the SIZING wins, because detection power is the entire reason this criterion exists.

  Consequences, stated so they cannot be traded away quietly:
  - There is no *degraded-power pass*. Fewer than 50 collected runs is a FAILURE as *measured nothing*, reported loud with the collected count and every exclusion reason — never a short count dressed up as a pass, and never a length mismatch.
  - The machine-load argument still holds where it applies: it justifies not capping exclusions, and it does NOT justify accepting a smaller counted sample. A busy host spends more attempts, not fewer runs.
  - The shipped harness sets `MIN_CONCLUSIVE_RUNS = 20` and passes at degraded power, so it does NOT satisfy AC-IC-1 as declared here. The implementation owes the change; the spec is not being bent to match it.
- **AC-IC-2's forced-contention control bounds it by an ABSOLUTE cap**: at most 10 excluded runs, i.e. `MAX_CONTROL_ATTEMPTS = CONTROL_RUNS + 10 = 20` attempts to collect `CONTROL_RUNS = 10` counted runs. An absolute cap is the right shape here because the control FORCES contention instead of sampling it, so a high exclusion rate means the fixture is broken, not that the host is busy.

**The contract check runs FIRST and unconditionally**, over every collected sample, before any floor or cap is evaluated. A sample shortfall must never suppress a violation, and the diagnostics name the offending runs rather than only a count.

**Order matters, and the order is part of the contract.** Exclusion checks do NOT uniformly win. For AC-IC-1 the native-module race is checked FIRST (a pair in which either invocation never loaded never became two competing writers), while the outside-report-write check runs AFTER the two conforming shapes (a run that already produced a declared loud failure measured the contract, whatever else happened). For the AC-IC-2 control a detected loud failure wins over BOTH exclusion reasons: the criterion is satisfied by one declared refusal, and a crashed or startup-blocked sibling cannot un-observe it.

### D6 classifier decision table

Enumerated so suite completeness stops resting on reviewer judgment. Rows are evaluated top to bottom; `template` means the declared three-part stderr template of §Contract Details.

| # | first | second | verdict |
|---|---|---|---|
| 1 | any, stderr carries a dlopen token | any | `not_attributable` / `native_module_load_race` |
| 2 | exit 0 | exit 0 | `conforming` / `both_succeeded` |
| 3 | exit 0 | exit 5 + template | `conforming` / `one_refused_loudly` |
| 4 | exit 5 + template | exit 0 | `conforming` / `one_refused_loudly` (symmetric — the contract names no designated winner) |
| 5 | exit 0 | exit 5, stderr does NOT match template | `non_conforming` |
| 6 | exit 0 | exit ≠ 0 and ≠ 5, stderr carries the locked-database message without template | `not_attributable` / `contention_outside_report_write` |
| 7 | exit ≠ 0 | exit ≠ 0, at least one carrying the locked-database message without template | `not_attributable` / `contention_outside_report_write` |
| 8 | exit ≠ 0 | exit ≠ 0, neither locked-database nor dlopen | `non_conforming` (both-non-zero, exit codes quoted back) |
| 9 | exit 0 | exit 5 + template whose source field is the literal `unknown-source` | `conforming` — per D5 the literal is what makes "name the contender when available" falsifiable |
| 10 | exit 0 | exit 5, template shape present but NO source field at all | `non_conforming` — a message that names nothing is never conforming (D5) |

### AC-IC-2 forced-contention control decision table

The control's question is deliberately different: with contention forced by an externally held open write transaction, the criterion is "did at least one invocation produce the declared loud failure", and the first invocation's status is unconstrained because the external lock blocks it too.

| # | condition | verdict |
|---|---|---|
| 1 | both invocations produce the declared loud failure | `detected`, refused 2 |
| 2 | exactly one produces it | `detected`, refused 1 |
| 3 | neither refuses loudly; either carries a dlopen token | `not_attributable` / `native_module_load_race` |
| 4 | neither refuses loudly; either carries the locked-database message without template | `not_attributable` / `contention_outside_report_write` |
| 5 | both exit 0 | `undetected` — the fixture never created contention |
| 6 | anything else | `undetected`, exit codes and both stderrs quoted back |

Row 4 is the one the original wording got wrong. The external transaction blocks the STARTUP write first, so the second invocation can die with a generic `database is locked` before the report write is ever attempted. Counting that as `undetected` reports the criterion failing when the run simply never reached the contract — a false RED, and an intermittent one, since the startup write only contends when `CREATE TABLE IF NOT EXISTS` or `pruneExpired()` actually needs the write lock.


## Acceptance Criteria (structured)

- [·] [script] AC-IC-1: each of 50 consecutive counted runs ends in exactly one of two states: both invocations exit 0 with both issues present in the upstream corpus, or exactly one exits 0 while the other exits with the declared code and stderr matching the declared template; any other combination including two non-zero exits is a failure, checked first and unconditionally over every collected sample; a run for which the D6 classifier returns not_attributable is EXCLUDED per D7 and does not count toward the 50, each exclusion reported with the classifier reason, exclusions bounded only by total effort (800 attempts, 300000ms budget) and never by count; the counted sample must reach exactly 50 or the criterion FAILS as measured-nothing with the collected count and every exclusion reason named — there is no degraded-power pass, because 50 is the sizing that gives this criterion its detection power
  script: e2e — bunx --bun vitest run packages/lore/tests/integration/cli/issue-report-concurrency.bun.test.ts -t 'fifty runs only conforming outcomes'
  other_command=2
- [⚑] [script] AC-IC-3: a grep for setTimeout or sleep or backoff over EVERY path named in D3 returns zero matches — the count is deliberately NOT restated in this statement, because D3's list is the SSOT and has already changed once (2026-08-24: a deleted module removed, its three successor modules appended), so a number here would go stale silently while still reading as a specification — with the path list read from the spec so the target cannot be narrowed after the fact, AND the checker asserts that every path in that list EXISTS and fails loud naming the missing one — the existence assertion is required because a grep over a path that is not there returns zero matches, which is indistinguishable from a clean file, and this list has already shipped a nonexistent path under which this criterion would have passed while measuring nothing
  script: lint — bun run check:no-timer-retry
- [·] [script] AC-IC-4: the loud-failure stderr matches the declared template carrying a session or PID or host source field, or the literal unknown-source when unresolvable, plus a retry command line, asserted by string or regex match
  script: e2e — bunx --bun vitest run packages/lore/tests/integration/cli/issue-report-concurrency.bun.test.ts -t 'failure message names contender and next action'
  other_command=2
- [·] [script] AC-IC-2: contention is forced by holding an open write transaction on the upstream corpus for the full duration of the second invocation; in all 10 counted control runs at least one invocation produces the declared loud failure, the status of the first invocation is unconstrained, and a run where both succeed fails this criterion; a control run for which the classifier returns not_attributable is EXCLUDED per D7 and does not count toward the 10, including a startup-phase locked-database refusal carrying neither the declared code nor the declared template (forced-contention table row 4), subject to an absolute bound of at most 10 excluded runs within 20 attempts
  script: e2e — bunx --bun vitest run packages/lore/tests/integration/cli/issue-report-concurrency.bun.test.ts -t 'forced contention control'
  other_command=2
- [⚑] [script] AC-IC-6: the pure conforming-outcome classifier maps a pair of exitCode and stderr to the D2 verdict, unit-tested over every row of both decision tables enumerated in D7 (10 rows for the D6 classifier including both not_attributable reasons, 6 rows for the forced-contention control) with no spawn, and the 50-run harness calls it rather than re-implementing the rule
  script: test — bunx vitest run packages/lore/tests/unit/core/issue-concurrency-classifier.test.ts -t 'classifies conforming and non-conforming pairs'
- [·] [script] AC-IC-5: the 2 concurrent CLI invocations case (issue-report-cross-corpus.bun.test.ts:590, AC-072-9) asserts the specified contract and the previous unconditional r1/r2 exitCode 0 assertions at :626-627 are gone from the file
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/service/issue-report-cross-corpus.bun.test.ts -t 'concurrent CLI invocations'
  other_command=2

## Code anchors

- packages/core/src/issue-report.ts
- scripts/check-no-timer-retry.ts
- packages/lore/src/adapters/cli/commands/report-issue.ts
- packages/lore/src/service/gh-runner.ts
- packages/lore/src/service/github-intake-port.ts
- packages/lore/src/service/issue-resolution.ts
- scripts/tests/check-no-timer-retry.test.ts
