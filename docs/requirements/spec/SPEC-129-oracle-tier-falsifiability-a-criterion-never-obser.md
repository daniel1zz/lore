---
id: SPEC-129
type: spec
role: spec
title: "Oracle-tier falsifiability: a criterion never observed red is a computed state, plus pipe-refusal and unclaimed-oracle detection"
status: approved
priority: high
created: 2026-08-07
updated: 2026-10-10
tags: []
links:
  - {id: TASK-338, type: informs}
---
# Overview

Make "this oracle was never shown to be able to fail" a **computed corpus fact** instead of a
discipline. Governed by
`adr-falsifiability-moves-from-the-task-tier-to-the-oracle-tier`, which reduces seven
failures observed 2026-08-02 → 2026-08-07 to that one sentence and establishes why the
existing three-question review lens is the wrong LAYER for it (it was carried, answered, and
still missed `AC-ACQ-6`'s vacuity).

Three deterministic, zero-LLM mechanisms over data the corpus already stores.

# Scope

## In scope

1. **M1 — `falsified` as a fourth coverage dimension.** `computeAcCoverage`
   (`packages/core/src/acceptance.ts`) gains a per-criterion `falsified` count: `ac_ref` rows
   whose `result` is `expected-fail` or `fail`. `deriveAcCoverageState` gains a
   `pass_unfalsified` state — pass > 0 AND falsified === 0. `expected-fail` refs are today
   counted in neither bucket (`acceptance.ts:209`), so the raw material exists; only the
   derivation is missing.
2. **M1 surfacing.** `lore ac list` renders `pass_unfalsified` distinctly from `pass` in BOTH
   the human table and `--json`; `lore status` reports a corpus-wide count.
3. **M2 — pipe refusal.** `lore evidence` refuses a SELF-REPORTED row whose `--command`
   contains a shell pipe (`|`), because `$?` after a pipe belongs to the last stage and the
   recorded `result` therefore cannot have been measured. Hosted as a fifth guard beside the
   four already in `adapters/cli/evidence-precheck.ts` — a new exported predicate
   (`findPipeRefusal`, AC-FALS-7) COMPOSED into the existing refusal chain, never a parallel
   entry point callers must remember to invoke.
4. **M3 — unclaimed-oracle report.** A `-t` / `--testNamePattern` / `--test-name-pattern`
   value present in a repo test file that NO declared AC binds is reported. This is how a
   silently WITHDRAWN claim becomes visible.
5. **M4 — `fail_superseded`, the recency semantics `state` was missing.** ADDED 2026-08-07
   after M1's first self-application surfaced the defect. `deriveAcCoverageState` reduced an
   append-only LOG through a precedence built for a simultaneous SET, so ONE honest historical
   `result: fail` row pinned a criterion to `fail` permanently. `falsified` counting every red
   row forever is CORRECT (its question — "was this ever observed able to go red" — is
   inherently historical); `state` doing so is WRONG (its question is "what is this criterion's
   condition NOW"). The two dimensions want opposite time semantics over the identical rows,
   which a single-pass reduction cannot express. `EvidenceRefLite` therefore gains an OPTIONAL
   `recorded_at`, and `state` gains `fail_superseded`.
6. **M5 — `not_measured`, closing M1's fail-open on an absent `falsified`.** ADDED 2026-08-07.
   `falsified === 0` discriminated a real zero from nonzero, but an ABSENT `falsified` routed
   into the observed-red branch and read `pass` — the optimistic direction. A required-field
   type annotation is a compile-time claim, not a runtime guarantee, and hand-built test
   fixtures are exactly where it does not hold. `state` gains `not_measured` and the dashboard
   test tree stops being excluded from typecheck.

## Out of scope — explicit non-goals, with reasons

- **Blocking on `pass_unfalsified`.** ⛔ RETRACTED FIGURE, corrected 2026-08-07 after merge: the
  original wording read *"574 of 700 criteria (82.0%) are `pass_unfalsified`"* and that number is
  FALSE. Re-measured over all 138 specs by iterating `lore ac list --json` and tallying
  `deriveAcCoverageState`: **29 of 724 (4.0%)** are `pass_unfalsified`. The retracted 574 matches
  today's `attested_pass` count (579) almost exactly, so it was a precedence conflation —
  `attested_pass` is checked BEFORE `pass_unfalsified`, and the original tally evidently did not
  apply that ordering. It cannot have been drift: moving 545 criteria out of `pass_unfalsified`
  would take 545 `lore verify` attestations, and the interim recorded evidence on 6 tasks.
  Full distribution at the M4/M5 merge commit: `attested_pass` 579, `fail_superseded` 58, `none`
  39, `pass_unfalsified` 29, `pass` 15, `fail` 4.
  ⛔ **The report-only decision therefore rests on a premise that no longer holds.** At 4.0% the
  "arming it puts the corpus in violation on the landing commit" argument is nearly vacuous — 29
  criteria is a clearable backlog, not a corpus-wide violation. What survives the correction is
  the SECOND reason, which never depended on the count: pressure to clear a red line manufactures
  synthesized red runs indistinguishable from real ones
  (`knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`), and M1 by construction cannot
  tell a real falsification from a throwaway inverted assertion. Report-only STANDS on that reason
  alone, and the back-catalogue is grandfathered by THIS written exemption, never by authored
  artifacts — but ⛔ whether to arm it is now an OPEN question for the humans, reopened by this
  correction, not a settled non-goal.
  ⛔ The four criteria that genuinely read `fail` (not `fail_superseded`) at the merge commit are
  real corpus red, unrelated to this spec: `AC-061-7`, `AC-062-3`, `AC-062-5`, `AC-064-7`.
- **Expiring a criterion's falsified basis when `lore ac set` restates it.** Per-criterion
  edit provenance does not exist in the schema. The coarse substitute (evidence `at` vs the
  spec's `updated_at`) is REJECTED: any spec edit would mark every criterion stale, and a
  false signal is worse than an absent one. Needs per-criterion edit timestamps — its own
  slice.
- **Proving an oracle fails on the RIGHT input** (mutation-based discrimination). M1 proves
  only that it CAN fail; a trivial inversion satisfies it. Accepted residual, named in the
  ADR.
- Changing `--capture`'s behaviour. There lore spawns the command itself, so the pipe hazard
  does not apply.

# Design

`falsified` is derived in the SAME single pass `pass`/`fail`/`attested_pass`/`attested_fail`
already use — no second traversal, no new store round-trip. `deriveAcCoverageState` stays the
ONE fail-first precedence derivation both `task-feed-wiring.ts` and `commands/ac.ts`'s badge
consume; `pass_unfalsified` is inserted BELOW `pass` in that precedence so an attested pass
never degrades.

M2 composes into `findMissingOracleFilesForEvidence`'s existing refusal chain rather than
adding a parallel entry point. M3 is a script under `scripts/`, invoked by `lore status`, in
the shape `check-ac-ref-integrity.ts` already establishes.

## The seven-value precedence, after M4 and M5 (binding — this table IS the contract)

`deriveAcCoverageState` widens from five values to seven. Read top to bottom; the FIRST
matching row wins:

| # | State | Condition |
|---|---|---|
| 1 | `fail` | `fail > 0` AND NOT superseded (see below) |
| 2 | `fail_superseded` | `fail > 0` AND superseded |
| 3 | `attested_pass` | `fail === 0` AND `attested_pass > 0` |
| 4 | `not_measured` | `fail === 0` AND `attested_pass === 0` AND `pass > 0` AND `falsified` is not an integer `>= 0` |
| 5 | `pass_unfalsified` | `fail === 0` AND `attested_pass === 0` AND `pass > 0` AND `falsified === 0` |
| 6 | `pass` | `fail === 0` AND `attested_pass === 0` AND `pass > 0` AND `falsified > 0` |
| 7 | `none` | `pass === 0` AND `fail === 0` |

⛔ Seven is the COMPLETE return set of `deriveAcCoverageState`. `inconclusive` and
`expected-fail` are NOT members and MUST NOT be added: they are badge-layer residuals that
`commands/ac.ts::coverageBadge` derives from `fact.refs` only AFTER the derivation has already
returned `none`, rendering `⚑?(n)` / `⚑R(n)` / `·`. That layering is UNCHANGED by M4 and M5 —
AC-FALS-19's requirement that the two new badges be distinct from `⚑?` and `⚑R` is a statement
about the badge chain, not a request for two more derivation states. `attested_fail` needs no
row: it counts refs whose `result` is `fail` AND attested, so `attested_fail > 0` implies
`fail > 0` and rows 1-2 already own it.

**Superseded** = the newest ATTESTED pass ref is STRICTLY newer than the newest `fail` ref, by
`recorded_at`. Three fail-closed tie-breaks, each one a deliberate choice toward `fail`:

- Equal timestamps do NOT supersede — a tie keeps `fail` (this is the residual `--worktree`-era
  same-second batch inherits, and it is the safe direction).
- A ref whose `recorded_at` is absent or non-string is UNUSABLE: on a `fail` ref treat it as
  newest (cannot be superseded); on a pass ref treat it as oldest (cannot supersede).
- An UNATTESTED pass never supersedes, however new. Only a runner-attested pass clears a fail.

⛔ Row 4's predicate is `Number.isInteger(falsified) && falsified >= 0`, NEGATED — deliberately
phrased as a positive well-formedness test rather than a list of bad values. A "not a finite
number" phrasing was rejected during review: it leaves a finite NEGATIVE `falsified` matching no
row at all while `pass > 0` also excludes row 7, which is the same fail-open shape M5 exists to
close. Rows 4-6 are now total over every possible `falsified` value.

⛔ `not_measured` sits at rank 4, NOT above `fail`/`attested_pass`, because a malformed
`falsified` invalidates EXACTLY the discrimination `falsified` powers and nothing else — ranks
1-3 and 7 never read the field, so their inputs stay independently valid. Ranking it higher
would suppress a true `fail` behind a fixture defect, inverting the fail-first rule M4 is
otherwise preserving. ⛔ `not_measured` is also NOT more favourable than `pass`: it is a
distinct non-committal reading, never a silent substitution for either neighbour.

⛔ Named residual of M4: a criterion whose `fail` is real and current, followed by an attested
pass produced against a DIFFERENT tree, reads `fail_superseded`. Supersession proves recency,
never that the same code was under test — the same class of proxy gap M1's own ADR names and
accepts. AC-FALS-16 bounds the failure surface to that one case by pinning the three
fail-closed tie-breaks.

⛔ `recorded_at` on `EvidenceRefLite` is OPTIONAL, not required, and the derivation defends
itself against its absence — deliberately, because M5 is the measured proof that a required
field is unenforced wherever facts are hand-built.

# Acceptance Criteria

Declared structurally via `lore ac add` — see `lore ac list` on this spec. Prose here is
non-authoritative.

⛔ Every criterion below must land with its OWN `expected-fail` control run recorded against
its own `ac_ref`.

This spec's criteria are subject to M1, and the dogfood condition is: **every criterion reads
`falsified >= 1` WITH an attested green.** Anything reading `pass_unfalsified` here is a
criterion whose red-first control was skipped. `fail_superseded` (M4) SATISFIES this condition
and is not an exception to it: the state is unreachable without an attested pass strictly newer
than a red row, so it entails both halves — `falsified >= 1` from the red row and the attested
green from the row that superseded it.

⛔ CORRECTED 2026-08-07, after `lore assess` caught the original wording (verdict met 85/100,
gap "Plan self-consistency"): the first version said *"if they land `pass_unfalsified`, the
mechanism is reporting truthfully about itself and that reading IS the dogfood proof."* That
sentence was UNFALSIFIABLE BY CONSTRUCTION — the `expected-fail` requirement one line above it
forces `falsified >= 1`, so no criterion on this spec could ever land `pass_unfalsified`, and
the "proof" could never fail. Measured outcome under the corrected condition: 11 of 13 criteria
read `attested_pass` with `falsified: 1`; AC-FALS-11 and AC-FALS-13 read `fail` from an honest
interim `result: fail` row that no later attested pass can clear
(`task-one-honest-historical-fail-row-pins-a-criterion-to-state`). Zero read
`pass_unfalsified` — which was GUARANTEED, not achieved, and stating it as an achievement was
the original error.

⛔ SUPERSEDED IN PART, same day, by M4. The paragraph above was written when this spec declared
13 criteria; M4 and M5 added more, and `lore ac list` on this spec is the only current count —
⛔ do not restate a literal here, it drifts on every `lore ac add`. Its clause *"an honest interim `result: fail` row that no
later attested pass can clear"* was an accurate reading of the code AT THAT MOMENT and is now
FALSE BY CONSTRUCTION: M4 exists precisely to clear it, and AC-FALS-23 asserts on the LIVE
corpus that AC-FALS-11 and AC-FALS-13 read `fail_superseded`, not `fail`. The measurement
itself stands — 11 of the then-13 read `attested_pass` with `falsified: 1`, zero read
`pass_unfalsified` — only its permanence claim is retracted. Left in place rather than
rewritten because the sequence (measure → the measurement exposes a defect → fix the defect)
is the audit trail; silently editing it to match today's behaviour would erase the reason M4
exists.


## Acceptance Criteria (structured)

- [⚑] [script] AC-FALS-1: computeAcCoverage returns falsified:1 for a criterion whose ac_ref rows include one result expected-fail, and falsified:0 for a criterion whose ac_ref rows are all result pass
  script: test — bunx vitest run packages/core/tests/unit/ac-falsifiability.test.ts -t falsified-count
- [⚑] [script] AC-FALS-2: deriveAcCoverageState returns pass_unfalsified for a fact with pass greater than 0 and falsified equal to 0, and returns a state other than pass_unfalsified once falsified is greater than 0
  script: test — bunx vitest run packages/core/tests/unit/ac-falsifiability.test.ts -t coverage-state
- [⚑] [script] AC-FALS-3: deriveAcCoverageState still returns attested_pass for a fact with attested_pass greater than 0 and falsified equal to 0, so pass_unfalsified never outranks an attested pass
  script: test — bunx vitest run packages/core/tests/unit/ac-falsifiability.test.ts -t precedence-regression
- [⚑] [script] AC-FALS-4: lore ac list --json emits an integer falsified field and a coverage state string per criterion, and that state reads pass_unfalsified for a criterion with pass greater than 0 and falsified equal to 0
  script: test — cd packages/lore && bun test tests/unit/adapters/ac-list-falsified.bun.test.ts --test-name-pattern json-surfacing
- [⚑] [script] AC-FALS-5: lore ac list human table output carries a pass_unfalsified marker for a criterion never observed red, and that same marker is absent for a criterion with one expected-fail ref
  script: test — cd packages/lore && bun test tests/unit/adapters/ac-list-falsified.bun.test.ts --test-name-pattern human-render
- [⚑] [script] AC-FALS-6: lore status --json reports an integer count of corpus-wide pass_unfalsified criteria, and that count rises by exactly 1 when one more never-red criterion is declared
  script: test — cd packages/lore && bun test tests/unit/adapters/ac-list-falsified.bun.test.ts --test-name-pattern status-count
- [⚑] [script] AC-FALS-7: findPipeRefusal returns a refusal for a self-reported piped command whose oracle and result are in scope, and returns null for the identical piped command when capture is requested
  script: test — cd packages/lore && bun test tests/unit/adapters/evidence-pipe-refusal.bun.test.ts --test-name-pattern pipe-refusal
- [⚑] [script] AC-FALS-8: the unclaimed-oracle check reports a test-name-pattern value present in a repo test file that no declared AC binds, and reports zero findings for a value that a declared AC does bind
  script: test — bunx vitest run packages/lore/tests/unit/service/unclaimed-oracle.test.ts -t unclaimed-oracle
- [⚑] [script] AC-FALS-9: a real lore evidence process invoked with a piped --command and without --capture terminates with exit status 4, and the same process invoked with --capture terminates with exit status 0
  script: test — cd packages/lore && bun test tests/unit/adapters/evidence-pipe-wiring.bun.test.ts --test-name-pattern pipe-wiring
- [⚑] [script] AC-FALS-10: lore status --json reports a nonzero unclaimed-oracle finding count for a fixture corpus holding a test-name-pattern value bound by no criterion, and reports zero for a fixture where that value is bound
  script: test — cd packages/lore && bun test tests/unit/adapters/ac-list-falsified.bun.test.ts --test-name-pattern unclaimed-wiring
- [⊘] [script] AC-FALS-11: with falsified present as a required field on AcCoverageFact, bun run typecheck terminates with exit status 0 across every workspace sub-step
  script: tsc — bun run typecheck
- [⚑] [script] AC-FALS-12: the exact vitest invocation declared as this criterion's command — enumerating every vitest-runner file that imports AcCoverageFact or the coverage-state derivation, discovered by symbol search at authoring time — terminates with exit status 0; that invocation, not the semantic category, is the whole oracle
  script: test — bunx vitest run packages/core/src/acceptance.test.ts packages/core/src/evidence-panel.test.ts packages/lore/tests/unit/adapters/task-feed-wiring.test.ts packages/lore/tests/unit/service/outline-service.test.ts packages/lore/tests/unit/core/phase-completion.test.ts packages/lore/tests/unit/service/feed-attestation-ac-diagnostics.test.ts packages/lore/tests/unit/service/outline-render.test.ts packages/lore/tests/unit/service/plan-close-vacuity-guard.test.ts packages/lore/tests/unit/service/ac-service.test.ts
- [⊘] [script] AC-FALS-13: the exact bun test invocation declared as this criterion's command — enumerating every bun-runner file affected by the required-field addition, including the file asserting the literal rendered coverage label — terminates with exit status 0; that invocation, not the word affected, is the whole oracle
  script: test — cd packages/lore && bun test tests/unit/adapters/cli-ac-coverage-badge.bun.test.ts tests/integration/cli-feed-task-start.bun.test.ts tests/unit/dashboard-assets-loader.bun.test.ts tests/unit/adapters/ac-list-falsified.bun.test.ts
- [⚑] [script] AC-FALS-14: deriveAcCoverageState returns fail_superseded for a fact whose only fail ref is strictly older than an attested pass ref, returns fail for the reversed ordering, and returns attested_pass for an otherwise identical fact carrying no fail ref at all, with the three readings asserted mutually distinct inside one test
  script: test — bunx vitest run packages/core/tests/unit/ac-falsifiability.test.ts -t supersession-recency
- [⚑] [script] AC-FALS-15: the falsified count of the fail_superseded fixture and of the fail control fixture each equal their exact expected integer asserted as a number rather than as nonzero, so the supersession rule changes state without altering the historical falsified dimension
  script: test — bunx vitest run packages/core/tests/unit/ac-falsifiability.test.ts -t supersession-falsified-invariant
- [⚑] [script] AC-FALS-16: supersession fails closed on three inputs asserted in one test, an attested pass whose recorded_at equals the fail ref recorded_at, an attested pass whose recorded_at is absent, and an unattested pass strictly newer than the fail ref, each of the three still yielding fail
  script: test — bunx vitest run packages/core/tests/unit/ac-falsifiability.test.ts -t supersession-fail-closed
- [⚑] [script] AC-FALS-17: deriveAcCoverageState returns not_measured for a pass-only fact whose falsified is undefined, null, NaN, or a negative number, and in the same test returns pass_unfalsified for falsified 0 and pass for falsified 1, so the six inputs map to exactly three mutually distinct readings
  script: test — bunx vitest run packages/core/tests/unit/ac-falsifiability.test.ts -t absent-falsified
- [⚑] [script] AC-FALS-18: with falsified undefined a fact with fail greater than 0 still yields fail, a fact with attested_pass greater than 0 and no fail still yields attested_pass, and a fact with no evidence still yields none, so not_measured replaces only the branch that consults falsified and shadows no other branch
  script: test — bunx vitest run packages/core/tests/unit/ac-falsifiability.test.ts -t falsified-branch-scope
- [⚑] [script] AC-FALS-19: commands/ac.ts coverageBadge returns one marker for a fail_superseded fact and another for a not_measured fact that are distinct from each other and from the inconclusive and expected-fail residual markers, so neither new state falls through the if-chain to a residual reading
  script: test — cd packages/lore && bun test tests/unit/adapters/cli-ac-coverage-badge.bun.test.ts --test-name-pattern badge-new-states
- [⚑] [script] AC-FALS-20: SpecAcCoveragePanel renders a fail_superseded row and a not_measured row whose badge variants differ from each other and from the pass_unfalsified row rendered in the same test, and its CoverageState type is the return type of deriveAcCoverageState rather than a locally re-declared union
  script: test — bunx vitest run packages/dashboard/tests/component/SpecAcCoveragePanel.test.tsx -t new-coverage-states
- [⚑] [script] AC-FALS-21: the makeFact helper called with no override yields a fact whose falsified satisfies typeof number asserted at runtime, and in the same test a fact identical except for a deleted falsified renders a coverage state different from the defaulted fact, so no expectation in the file could have been green only because the field was absent
  script: test — bunx vitest run packages/dashboard/tests/component/SpecAcCoveragePanel.test.tsx -t makefact-falsified-required
- [⚑] [script] AC-FALS-22: the tsconfig project covering packages/dashboard/tests resolves SpecAcCoveragePanel.test.tsx into its emitted file list, and running that same project over a fixture whose AcCoverageFact omits falsified terminates with a nonzero status carrying an error that names falsified
  script: tsc — bunx vitest run packages/dashboard/tests/unit/typecheck-scope.test.ts -t dashboard-tests-typechecked
- [⚑] [script] AC-FALS-23: on the live corpus the production lore ac list read path reports AC-FALS-11 and AC-FALS-13 with state fail_superseded instead of fail while AC-FALS-3 still reports attested_pass, proving the new derivation is wired into the shipped read path and not merely implemented in the core function
  script: other — python3 -c "import json,subprocess,sys; d=json.loads(subprocess.run(['bun','run','packages/lore/src/index.ts','ac','list','spec-oracle-tier-falsifiability-a-criterion-never-observed-red','--json'],capture_output=True,text=True,check=True).stdout)['data']; s={f['ac_id']:f['state'] for f in d['coverage']}; ok = s.get('AC-FALS-11')=='fail_superseded' and s.get('AC-FALS-13')=='fail_superseded' and s.get('AC-FALS-3')=='attested_pass'; print('AC-FALS-11=' + str(s.get('AC-FALS-11')) + ' AC-FALS-13=' + str(s.get('AC-FALS-13')) + ' AC-FALS-3=' + str(s.get('AC-FALS-3')) + ' -> ' + ('PASS' if ok else 'FAIL')); sys.exit(0 if ok else 1)"
- [⚑] [script] AC-FALS-24: one test asserts together that the typecheck chain declared in package.json invokes the dashboard project whose resolved file list contains packages/dashboard/tests files, and that this same project reports zero errors, so a repo-wide typecheck can no longer pass while the dashboard test tree is unchecked
  script: test — bunx vitest run packages/dashboard/tests/unit/typecheck-scope.test.ts -t typecheck-chain-covers-tests

## Code anchors

- packages/core/src/acceptance.ts#computeAcCoverage
- packages/core/src/acceptance.ts#deriveAcCoverageState
- packages/core/src/acceptance.ts#AcCoverageFact
- packages/core/src/acceptance.ts#EvidenceRefLite
- packages/lore/src/adapters/cli/commands/ac.ts#coverageBadge
- packages/lore/src/adapters/cli/task-feed-wiring.ts
- packages/lore/src/adapters/cli/commands/status.ts
- packages/dashboard/src/components/evidence/SpecAcCoveragePanel.tsx
- packages/core/tests/unit/ac-falsifiability.test.ts
- packages/lore/tests/unit/adapters/ac-list-falsified.bun.test.ts
- packages/lore/tests/unit/adapters/cli-ac-coverage-badge.bun.test.ts
- packages/dashboard/tests/component/SpecAcCoveragePanel.test.tsx
- packages/dashboard/tests/unit/typecheck-scope.test.ts
- packages/lore/tests/unit/service/ac-service.test.ts
