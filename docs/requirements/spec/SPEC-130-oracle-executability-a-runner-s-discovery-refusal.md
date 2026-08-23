---
id: SPEC-130
type: spec
role: spec
title: "Oracle executability: a runner's discovery refusal is not a measurement, and must never mint a red"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-23
tags: []
parent: PRD-001
---
# Overview

A script-mode AC whose `verify.command` names a test path that does not exist records a
permanent, indistinguishable `fail`. Every runner this repo uses returns **exit 1** for a
discovery refusal — the same exit code an assertion failure returns — and `lore` reads only
the exit code. The criterion is pinned red forever while nothing was ever executed.

This became load-bearing when SPEC `oracle-tier-falsifiability` M1 turned `fail` into a
SIGNAL (the `falsified` count). Before M1 a wrong red cost one wrong red; after M1 a wrong
red is minted into a credential.

## The asymmetry, stated once

Both evidence paths guard ONLY the optimistic direction:

| path | pass direction | fail direction |
|---|---|---|
| self-reported (`lore evidence`) | five guards in `adapters/cli/evidence-precheck.ts`, all behind `isSelfReportedPassInScope` (`oracle in {test,e2e} && result === "pass"`) | NONE |
| attested (`lore verify`) | completeness guard downgrades `pass` to `inconclusive` on zero/under-match | NONE — `deriveVerifyResult` maps exit != 0 to `fail`; the completeness block is gated on `executedSuccessfully` |

`verify-runner-service.ts` states the assumption in its own words: *"Runs ONLY when the
process actually exited 0 (a nonzero exit/timeout is already fail, completeness is
irrelevant to it)"*. That assumption IS the defect — a discovery refusal is a
zero-execution event, and completeness is maximally relevant to it.

## Three consumers of one wrong row

1. **false red** — `state` pinned `fail`; recency semantics cannot rescue it (every later row is also red)
2. **false falsifiability** — `falsified` increments, so the criterion reads "proven able to go red" though nothing ran
3. **false red-first credit** — `task-workflow-service.ts:2385-2387`'s `done()` red-first floor counts `"fail"` REGARDLESS of cause, so a typo satisfies the very discipline that exists to prove an oracle can fail

## Measured incidence (2026-08-10, all 138 specs / 724 criteria)

`attested_pass` 590 · `fail_superseded` 58 · `none` 38 · `pass_unfalsified` 29 · `pass` 5 · `fail` 4.

Three of the four genuine reds are this defect. `git log --diff-filter=DR --all` returns
NOTHING for `packages/core/tests/acceptance.test.ts` and
`packages/lore/tests/unit/http/config-routes.test.ts` — the paths were mistyped at authoring
time and never once measured what they claimed to. Corrected to
`packages/core/src/acceptance.test.ts` and
`packages/lore/tests/unit/adapters/http/config-routes.test.ts`, all three exit 0.
`AC-064-7` is green today (23 passed, persisted exit 0), pinned only for want of a later pass row.

# Scope

## In scope

### M6.1 — `findDiscoveryRefusal`, the missing primitive

The obvious fix — dropping the `executedSuccessfully` gate so the completeness guard also
runs on exit != 0 — is a **NO-OP**, confirmed by two independent routes (direct read of the
pattern constants plus captured runner output, and an independent extension review).
`judgeCompleteness` consumes `parseExecutedUnits(outputTail)`, which recognises exactly two
shapes: `/Test Files\s+.*?\((\d+)\)/` and `/\bRan\s+(\d+)\s+tests?\s+across\s+(\d+)\s+files?\b/i`.

Captured verbatim on 2026-08-10 — what the runners ACTUALLY print for a nonexistent path:

| runner | exit | stdout | matches a summary pattern |
|---|---|---|---|
| vitest | 1 | `No test files found, exiting with code 1` | no |
| bun test | 1 | `The following filters did not match any test files in --cwd="..."` + `861 files were searched` | no |
| playwright | 1 | `Error: No tests found.` | no |

None carries a summary line, so `parseExecutedUnits` returns `null`, `judgeCompleteness`
returns `unknown_runner`, and the downgrade (which fires only on `zero_match`/`under_match`)
never runs. Without this primitive the rest of the change is theatre.

`packages/core/src/attestation-completeness.ts` gains:

```ts
export type DiscoveryRefusal = {
  readonly runner: "vitest" | "bun" | "playwright";
  /** The verbatim line that proved it — the refusal message quotes the runner, never paraphrases. */
  readonly evidence: string;
};
export function findDiscoveryRefusal(outputTail: string): DiscoveryRefusal | null;
```

**Why specificity is the whole answer.** These phrases are emitted ONLY on discovery failure
and are mutually exclusive with a summary line. A run that genuinely executed and failed
always carries `Test Files ... (N)` / `Ran N tests across M files`. The false-negative a
generic "0 matched" heuristic would deserve — swallowing a real assertion failure as
`inconclusive` — is structurally unreachable through this predicate.

**Verified non-collision with `bun run test:changed`'s loud-zero contract**: that wrapper
deliberately exits 1 when a non-empty changed set selects 0 tests, but NEVER spawns a runner
in that branch, so its tail carries only its own `FAIL: 0 tests selected...` accounting lines.
The deliberate loud-zero stays loud.

### M6.2 — the attested call site

`service/verify-runner-service.ts` evaluates `findDiscoveryRefusal(outputTail)` on the
exit != 0 branch; a refusal records `inconclusive`, never `fail`. Existing
`oracle === "test"` scoping is preserved.

### M6.3 — declaration-time path existence

`extractTestFileTokens` / `computeCandidateRoots` / `findMissingOracleFiles` / `FileExistsPort`
are promoted OUT of `adapters/cli/evidence-precheck.ts` into
`packages/core/src/oracle-file-existence.ts`, mirroring `attestation-completeness.ts`'s
established precedent (pure + injected port + multi-adapter consumer). Consumed by three
call sites: `commands/evidence.ts`, `adapters/mcp/tools.ts`, and newly
`AcService.addCriterion` / `setCriterion`.

**Measured scope limit, stated rather than hidden**: of the 19 script-mode `pass_unfalsified`
criteria, FIVE carry no test-path token at all — `bun run test`, `bun run typecheck`,
`test $(grep -rln ... | wc -l) -eq 0`, `bun run dev -- setup --dry-run ...`, and a
`diff <(shasum ...) <(shasum ...)` pair. Declaration-time validation is structurally silent
on these. AC-OX-4 asserts that limit explicitly rather than letting a green run imply full coverage.

### M6.4 — corpus cleanup, then arming

Correct the three mistyped commands and re-attest all four reds; clear the 29
`pass_unfalsified` criteria (19 script-mode via reverse-control falsification, 10 human-mode
via a hand-recorded reverse observation); THEN arm `pass_unfalsified` as a blocking gate.

Human decision 2026-08-10: **clear the backlog first, then arm**. The retracted 82% figure
was a precedence conflation; the real figure is 29/724 = 4.0% — a clearable backlog, not a
corpus-wide violation. Arming at zero red gives nobody a motive to manufacture a synthetic
red to get past the gate.

## Out of scope

- **Changing `deriveAcCoverageState`'s precedence.** Only the RECORDING layer moves. AC-OX-8
  pins the derivation byte-unchanged, protecting the 58 `fail_superseded` and 590
  `attested_pass` from silent reclassification.
- **Widening `isSelfReportedPassInScope`.** It is shared by guards 1/2/3/5; widening it
  silently arms the pipe guard, whose entire premise ("a claimed pass's `$?` may be lying")
  is meaningless for a fail. The fail-direction check gets its OWN narrow predicate.
- **Proving an oracle fails on the RIGHT input** (mutation-based discrimination) — inherited
  non-goal from the governing spec.

# Design Decisions

| # | Decision | Choice | Rationale | Trade-off |
|---|---|---|---|---|
| D1 | Where do the file-existence primitives live | Promote to `@lore/core` | `attestation-completeness.ts` set the precedent for exactly this shape; a third consumer (`ac.ts`) is the trigger. A sibling under `adapters/cli/` would leave a service-layer gate owned by a CLI adapter | One more indirection; `@lore/core` must stay Node-builtin-free (the port keeps it so) |
| D2 | Widen the shared scope gate | NO — new narrow predicate | Widening silently arms three unrelated guards in a direction none of them reason about | Two scope symbols instead of one — more surface, each correctly bounded |
| D3 | What a discovery refusal records | `inconclusive` | Already carries "we do not know whether this measured the thing" for build-staleness and completeness; a third cause is consistent extension. Counts toward neither vocabulary, so it cannot mint a false `falsified` | A genuinely-red run that crashes mid-execution also downgrades — friction in the safe direction, never a masked defect |
| D4 | Detect by exit code or runner text | Runner text | Exit codes ARE the ambiguity being fixed; only the runner's own words separate "found nothing" from "ran and failed" | Three per-runner patterns; a runner changing wording degrades to today's bare `fail`, never to a false pass — AC-OX-5 pins each phrase against the LIVE runner |
| D5 | Correct the three commands or retire them | Correct in place, re-attest | The ACs are sound; only the paths were wrong. `lore ac set` preserves id and mode | Editing an AC demotes its spec to `draft` and freezes descendant claims — see Sequencing |
| D6 | Arm the gate now or after the backlog | After | 29/724 = 4.0% is a clearable backlog. Arming at zero red removes the motive to synthesize a red | One extra slice before the gate is live |
| D7 | KD4 residual — frozen file lists as AC oracles | Correct population is content discovery UNION subprocess reasoning | A content-marker scan is structurally blind to a subprocess/scan-style test naming no marker — the same residual `bun run test:changed` documents. Twice-measured in one slice (AC-FALS-12, AC-FALS-13) | Not fully mechanisable here; AC-OX-7 asserts the union is COMPUTED, not that it is complete |

## D8 — the declaration-time check must not break red-first TDD

⛔ Discovered while authoring this spec's OWN sibling specs, which is the strongest possible
evidence that it would have bitten every consumer: a red-first AC legitimately names a test
path that **does not exist yet**. "Mistyped path" and "not written yet" are
**indistinguishable from the path alone**, and every heuristic that tries (a similarly-named
file in the same directory, a fuzzy match against the tree) produces false accepts and false
refusals at the same time.

If M6.3 simply refuses a nonexistent path, it forbids declaring an AC before writing its
test — which is this repo's mandatory discipline (`~/.claude/skills/shared/verification-discipline.md`:
new tests go red first). The mechanism would be strictly worse than the defect it fixes.

**Resolution**: refuse by default, with ONE explicit, audited escape — `--allow-missing-path`
carrying a REQUIRED non-empty reason. The escape is not a silent fallback because it is
tracked: `lore status` reports the count of **unredeemed** declarations (an AC that claimed
`--allow-missing-path` and whose file STILL does not exist). A declaration that is never
redeemed is a dangling promise, and it must be visible as one rather than expiring quietly.

**Trade-off**: the escape can be abused. The mitigation is that abuse is *countable* — a
number that only ever grows is itself the signal. ⛔ This is the same shape as every other
guard in this spec: the fix is never "forbid the ambiguous case", it is "make the ambiguity
visible and attributable".

# Sequencing

`lore ac add` / `lore ac set` demote their spec to `draft`, which hard-blocks every
descendant `claim`. D5 edits ACs on SPEC-061, SPEC-062, SPEC-064, therefore:

1. Land M6.1–M6.3 FIRST, under this spec, touching no existing spec's ACs
2. Only then correct the three commands and re-attest — re-read each spec's status
   IMMEDIATELY before each dispatch, never from a batch-start snapshot
3. Clear the 29-criterion backlog
4. Arm the gate last

# Acceptance Criteria

Structured criteria are declared via `lore ac add` (the authoritative list is the
`## Acceptance Criteria (structured)` section below, and `lore ac list` on this spec —
⛔ never a hand-copied id range here, which goes stale the moment a criterion is added). Every one carries a
named way to make it go red; a green-only run does not count as verification.


## Acceptance Criteria (structured)

- [✔] [script] AC-OX-1: findDiscoveryRefusal returns a non-null verdict naming the correct runner for each of the three captured phrases (vitest 'No test files found', bun test 'did not match any test files', playwright 'Error: No tests found.'), and returns null for a tail carrying a real vitest failure summary line 'Test Files 3 failed | 4 passed (7)'. RED: delete any one of the three patterns and that runner's case returns null. Assert exit is EXACTLY 0, never merely non-zero.
  script: test — bunx vitest run packages/core/tests/attestation-completeness.test.ts -t discovery-refusal
- [✔] [script] AC-OX-2: verifyPlan records result inconclusive (NOT fail) for an injected executor returning exitCode 1 plus a vitest discovery-refusal tail, asserted on the recorded evidence entry's result field via the VerifyRunnerService constructor executor seam with no process spawned. RED FIRST IS MANDATORY: today the executedSuccessfully gate skips the completeness block entirely and records fail; that red must be recorded with lore evidence --result expected-fail by the agent that ran it, at the moment it was red.
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts -t refusal-inconclusive
- [✔] [script] AC-OX-3: REGRESSION: verifyPlan still records result fail for an injected executor returning exitCode 1 with a GENUINE failure tail carrying 'Test Files 1 failed (1)' — the fail path is narrowed, never removed. RED: broaden the predicate to match any exit != 0 and this criterion goes red.
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-completeness.test.ts -t genuine-failure-still-fail
- [✔] [script] AC-OX-4: AcService.addCriterion and setCriterion refuse a script-mode command naming a nonexistent test path, AND accept unchanged all five measured token-less commands (bun run test; bun run typecheck; a test $(grep -rln ...) form; a bun run dev -- setup --dry-run form; a diff <(shasum ...) <(shasum ...) form). The second half is load-bearing: it pins the guard's known structural blind spot instead of letting a green run imply full coverage. RED: point the probe at an existing path and the refusal must NOT fire.
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-service.test.ts packages/lore/tests/unit/service/ac-set.test.ts -t declared-path-existence
- [✔] [script] AC-OX-5: Each of the three discovery-refusal phrases is re-captured by SPAWNING the live runner against a nonexistent path and asserting findDiscoveryRefusal matches its real stdout — never a hand-copied fixture string. RED: pin a stale phrase and the live capture diverges. This is the oracle that survives a runner changing its wording.
  script: test — cd packages/lore && bun test tests/e2e/discovery-refusal-live-capture.bun.test.ts
- [·] [script] AC-OX-6: After the backlog is cleared, `lore status --json` reports pass_unfalsified_count 0, read from the JSON field itself. A literal count typed into any document is NOT acceptable evidence — a governance doc's literal figure is a claim with no oracle. ⛔ RE-BASELINED 2026-08-10. The prior version ALSO promised 'a corpus-wide fail count of 0, both read from the JSON fields themselves'. Measured that day: `lore status --json` HAS NO corpus-wide fail field (its keys are total_docs, invalid_docs, by_type, by_status, last_updated, db_size_bytes, invalidated_feeding_source_warnings, exempt_plans, ai_defaults, open_stale_candidates, code_anchor_specs, verification_profiles, pass_unfalsified_count, unclaimed_oracle, unredeemed_allow_missing_path_count) — so half the statement was unsatisfiable by construction, while the oracle command silently checked only pass_unfalsified_count. The fail-count half is NOT dropped: it moves to AC-OX-11, which is purely additive. Nothing was weakened; a promise the oracle never measured became a criterion with its own oracle. lore assess had already rated this AC a MAJOR (no evidence at all).
  script: other — lore status --json > /tmp/ox6.json; test "$(python3 -c 'import json;print(json.load(open("/tmp/ox6.json"))["data"]["pass_unfalsified_count"])')" = 0
- [·] [script] AC-OX-7: The test-file population used by any frozen-file-list AC oracle in this slice is COMPUTED as the union of content discovery and subprocess reasoning, and the computation names at least one file that content-marker scanning alone does not reach. RED: restrict the computation to content markers only and the named subprocess-style file disappears from the population. This asserts the union is computed, NOT that it is complete.
  script: test — bunx vitest run packages/core/tests/unit/ac-falsifiability.test.ts -t population-union
- [✔] [script] AC-OX-8: REGRESSION: deriveAcCoverageState's precedence is byte-unchanged — a hand-built fact with fail 1 and pass 0 still resolves to fail, and the corpus's 58 fail_superseded plus 590 attested_pass criteria are not reclassified by this change. Only the RECORDING layer moves; the DERIVATION must not. RED: alter any precedence branch and this reds.
  script: test — bunx vitest run packages/core/src/acceptance.test.ts -t precedence-unchanged
- [✔] [script] AC-OX-9: SERVICE LAYER: AcService.addCriterion/setCriterion's allowMissingPath option REQUIRES a non-empty reason when a declared path is missing (empty or absent reason is refused), and AcService.countUnredeemedAllowMissingPath recomputes from the LIVE filesystem on every call so creating the file drops the count with no further command. RED: create the previously-missing file and the count must decrease. ⛔ Re-baselined 2026-08-10: the prior wording promised `lore status --json` reports the count — a CLI-surface claim — while the anchor set and oracle covered only ac-service.ts. It took an attested pass (exit 0, 1037ms) while the implementer's own report stated commands/ac.ts and commands/status.ts were never touched, so production could not reach the mechanism. Scope narrowed to what the oracle measures; the wiring moved to AC-OX-10, purely additive.
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-service.test.ts -t allow-missing-path-unredeemed
- [✔] [script] AC-OX-10: PRODUCTION WIRING (live call sites, not implementation existence): a real `lore ac add <spec> <id> --mode script --oracle test --command <cmd naming a nonexistent test path>` is REFUSED at the CLI, the same call with --allow-missing-path plus a non-empty reason SUCCEEDS, the same call with --allow-missing-path and an empty/absent reason is REFUSED, and `lore status --json` emits the unredeemed-declaration count as a field. ⛔ The oracle MUST invoke the CLI (subprocess or the command's own handler), never AcService directly — asserting the service method exists is exactly the false-green this AC exists to prevent. ⛔ Use a throwaway mkdtemp + lore init corpus; NEVER write to this repo's own .lore/. RED: unwire either call site and this must fail.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/ac-allow-missing-path-cli.test.ts -t live-cli-wiring
- [·] [script] AC-OX-11: CORPUS FAIL CENSUS (the half split out of AC-OX-6 on 2026-08-10, purely additive): a corpus-wide census reports ZERO acceptance criteria in state 'fail', enumerated from the store rather than counted per-spec by hand, and the census NAMES each offender when non-zero. Baseline measured 2026-08-10: exactly four — AC-061-7, AC-062-3, AC-062-5, AC-064-7 — and all four were established to be FALSE reds (three named paths with no git history, one was already green), so the true defect count was 0, not 4. RED: re-point one criterion's command at a nonexistent path, re-run, and the census must report 1 naming that criterion. ⛔ DEPENDENCY: this AC is not verifiable until AC-FR-5 of spec-falsifiability-reachability ships the count enumerator — producing this census by hand today requires a throwaway script iterating every spec, which is precisely the gap AC-FR-5 closes. ⛔ Do NOT dispatch the corpus-cleanup phase before that lands: its own acceptance would otherwise rest on an unrepeatable hand-run.
  script: test — bunx vitest run packages/lore/tests/unit/service/corpus-fail-census.test.ts -t no-discovery-refusal-fails
- [✔] [script] AC-OX-12: THE DISCOVERY-REFUSAL GUARD MUST COVER EVERY WRITE PATH THAT MINTS A RED, NOT ONLY verifyPlan. Measured 2026-08-21: findDiscoveryRefusal is referenced in exactly ONE production file, packages/lore/src/service/verify-runner-service.ts (grep over packages/lore/src returns no other consumer). So lore verify correctly downgrades a refusal to inconclusive while lore evidence --capture, a second path that records pass/fail/expected-fail from a spawned command, never consults it. Demonstrated accidentally the same day: a poisoned cwd made 'bunx vitest run <path>' print 'No test files found, exiting with code 1' — vitest's own refusal phrase, already one of the three this spec captures — and --capture observed exit 1. It refused only because the declared --result was pass; had the declaration been expected-fail, that refusal would have been recorded as a genuine red carrying capture_source:runner, which is the corpus's runner-produced label. ⛔ This is the capability-versus-wiring split the root CLAUDE.md names: AC-OX-2 pins verifyPlan's call site and nothing pins the evidence path, so the primitive is implemented and only half wired. REQUIRED: the shared decision is consumed by BOTH write paths — a captured run whose output carries a discovery refusal cannot be recorded as fail or expected-fail; it is refused loudly or recorded inconclusive, and the message names the refusing runner. RED (both required): (a) drive the evidence path with a captured discovery-refusal output and --result expected-fail, and it must NOT produce a fail-family row; (b) CONTROL — drive it with a genuine assertion failure and expected-fail must still be recorded, so the guard narrows the path rather than closing it. Covered by the describe block named refusal-blocks-evidence-red.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-precheck.test.ts -t refusal-blocks-evidence-red 2>&1 && echo 'AC-OX-12 PASS: a captured discovery refusal cannot be recorded as a fail-family row through the evidence path, while a genuine assertion failure still can'
