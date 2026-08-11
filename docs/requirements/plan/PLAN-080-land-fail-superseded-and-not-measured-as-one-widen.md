---
id: PLAN-080
type: plan
role: plan
title: "Land fail_superseded and not_measured as one widening of the coverage derivation, absorbing the consumer ripple exactly once"
status: archived
priority: medium
created: 2026-08-07
updated: 2026-08-07
tags: []
parent: SPEC-129
phases:
  - {name: "derivation", description: "Widen deriveAcCoverageState to seven values (fail_superseded, not_measured), thread an optional recorded_at onto EvidenceRefLite, and wire every consumer plus every stale assertion in the same unit"}
  - {name: "typecheck-sweep", description: "Clear the 46 pre-existing strictness errors the un-excluded dashboard test tree surfaces, and wire that project into the repo-wide bun run typecheck"}
---
# Goal

Land M4 (`fail_superseded`) and M5 (`not_measured`) — the two defects M1's first
self-application surfaced — as ONE change to `deriveAcCoverageState`, widening its return set
from five values to seven and absorbing the consumer ripple exactly once.

The binding precedence table, the three fail-closed supersession tie-breaks, and the named
residuals live in the governing spec's Design section
(`spec-oracle-tier-falsifiability-a-criterion-never-observed-red` §"The seven-value
precedence"). ⛔ That table IS the contract — this plan does not restate it.

# Decisions taken before dispatch (user-ratified 2026-08-07)

| ID | Decision | Rejected alternative and why |
|---|---|---|
| D1 | M4 uses **Candidate C** — a distinct `fail_superseded` state. | Candidates A (latest-wins) and B (attested-supersedes-unattested) both make `[fail@t1, attested pass@t2]` read `attested_pass`, i.e. IDENTICAL to a criterion that never failed — which the defect report's own binding constraint forbids. They were not merely weaker; they were excluded by the constraint. |
| D2 | M5 returns a distinct `not_measured` reading rather than throwing or returning a `Result`. | `deriveAcCoverageState` is called synchronously inside React render (`SpecAcCoveragePanel.tsx:120`, `PhaseProgressPanel.tsx:166`); a pure core function throwing there blanks the panel. It also has no `Result` channel, and adding one rewrites five production call sites including two `.tsx` render paths. |
| D3 | The two filed defect tasks are executed as ONE task with ONE anchor set. | Sequential execution pays the consumer ripple twice (measured last slice: one added state value = 12 files) and forces the second implementer to rebase. Both defects change the same function's state cardinality. |
| D4 | `EvidenceRefLite.recorded_at` is **optional**, and the derivation fail-closes on its absence. | A required field would repeat exactly the mistake M5 exists to fix — a compile-time claim unenforced wherever facts are hand-built. |

# Ripple inventory — measured 2026-08-07 on `main` @ `1b90fabe`

`deriveAcCoverageState` has five production call sites (the table's first row is the return
DECLARATION, not a call site) and the state union is re-declared in three places. ⛔ TWO of the six are caught by `tsc` when the union widens — both because a
narrower duplicate union rejects the wider assignment. The other four are silent, and the one
that matters renders a wrong badge rather than failing.

| Site | Caught by tsc on widening? |
|---|---|
| `packages/core/src/acceptance.ts:398` — the return annotation | source of truth |
| `packages/lore/src/flows/task-feed-flow.ts:142` — narrower duplicate union | YES (assignment) |
| `packages/dashboard/src/components/evidence/SpecAcCoveragePanel.tsx:40` — narrower duplicate union + exhaustive `switch` in `stateVariant` | YES (assignment) |
| `packages/lore/src/adapters/cli/commands/ac.ts:573` — `coverageBadge`, **if-chain not a switch** | ⛔ NO — a new state falls through to the `⚑?` / `⚑R` / `·` residual markers and renders a silently wrong badge |
| `packages/lore/src/adapters/cli/commands/status.ts:524` — `=== "pass_unfalsified"` count | not applicable (count must stay unchanged) |
| `packages/dashboard/src/components/PhaseProgressPanel.tsx:166` — raw interpolation | not applicable (renders any string) |

## The typecheck exclusion — the filed diagnosis was WRONG, measured 2026-08-07

The defect report said the `makeFact()` required-field violation is invisible because
`packages/dashboard/tsconfig.json` excludes `tests`, and offered "route it through
`tsconfig.tests.json`, which typechecks it cleanly today" as a fix. ⛔ Both halves are false, and
the second is a false oracle:

- `tsconfig.tests.json` sets `include: ["src/**/*", "tests/**/*"]` but `extends`
  `./tsconfig.json`, and **`extends` does not reset `exclude`** — the base's
  `exclude: ["node_modules","dist","tests"]` is inherited, and `exclude` filters `include`.
- Measured: `bunx tsc -p packages/dashboard/tsconfig.tests.json --noEmit --listFilesOnly`
  resolves **648 files, of which ZERO are under `packages/dashboard/tests/`**. Its exit 0 is
  the exit code of checking nothing. The purpose-built tests project is silently inert.
- ⛔ The earlier "ran it directly and got exit 0" reading is the canonical false oracle:
  exit-code-true ≠ measured-the-right-thing.

With `exclude` corrected (probe config, since discarded), the tree resolves 63 test files and
reports **50 pre-existing errors across 19 files**: 19×TS18048, 13×TS2322, 8×TS2375, 4×TS2741,
3×TS2739, plus 3 singletons. Only **4** concern `falsified` — 2 in `SpecAcCoveragePanel.test.tsx`
and 2 in `packages/dashboard/tests/component/PhaseProgressPanel.test.tsx`, which is the sibling
hand-built fact helper the defect report predicted but did not name.

⛔ This is why the plan has two phases, not one. A new deterministic gate retroactively
invalidates the back-catalogue, and the sweep is budgeted in the SAME slice rather than deferred
to prose:

- **Phase `derivation`** fixes the config's inherited `exclude` and the 4 `falsified` errors.
  AC-FALS-22 proves the project genuinely resolves the test file and goes red on a violation.
  ⛔ It does NOT wire the project into `bun run typecheck` — the 46 unrelated errors would break
  AC-FALS-11 on the same commit.
- **Phase `typecheck-sweep`** clears those 46 and wires the project into the repo-wide
  `bun run typecheck` (AC-FALS-24).
- ⛔ Written residual, live between the two phases: the guard rail exists but is not enforced by
  the repo-wide typecheck until phase 2 lands. Named here so the gap is auditable rather than
  discovered.

## Stale assertions the change creates — same acceptance unit as the fix

⛔ These record the OLD behaviour and become false the moment the fix lands. Each is inside the
task's anchor set:

- `packages/core/src/evidence-panel.ts:826` — "mirrors `acceptance.ts::deriveAcCoverageState`'s
  'a fail always wins' rule". After M4 a fail does NOT always win.
- `packages/core/src/acceptance.ts:263-268` — the Silence note claiming `falsified === 0` is
  "never conflated with not measured". That claim is what M5 disproves.
- `packages/core/src/acceptance.ts:365-401` — the precedence JSDoc and its three `@example`s.
- `packages/core/src/CLAUDE.md:13` — states the ladder verbatim as
  `"fail" > "attested_pass" > "pass_unfalsified" > "pass" > "none"`.
  ⚠ This file is at 14863/16384 bytes (1521 free, advisory warn band). ⛔ If the edit would
  cross the ceiling, evict a block to the corpus and leave a one-line pointer — ⛔ never raise
  the ceiling, ⛔ never reflow long lines (the constraint is BYTES).
- `packages/lore/src/adapters/cli/CLAUDE.md:36` — `pass_unfalsified_count` prose. Verify it
  stays true (the count must not move) rather than assuming it.

# In-flight AC revision record (⛔ required by the re-baseline discipline)

Two criteria carrying prior PASS evidence had their statements edited while authoring this
plan. Recorded here because "AC red → edit AC → green" and "concealed failure" are
indistinguishable in an audit, whatever the intent:

- **AC-FALS-12 / AC-FALS-13** — statements only; `verify.command` UNCHANGED and byte-identical
  before and after. No red run was involved: the edit answers a review advisory that the
  population ("every consumer", "affected") was not enumerable from the text. The declared
  invocation was already the operative oracle; the new wording says so. This is strictly a
  narrowing of interpretation, not of the check.
- Residual, accepted by `agent:main-orchestrator` on authoring this plan, NOT user-ratified
  (unlike D1-D4): a command-declared population still passes green if the enumeration was
  under-inclusive at authoring time. The review judge flagged it twice. Closing it needs a
  discovery command (a glob or symbol query) as the criterion's oracle instead of a frozen file
  list — a separate slice, because it changes how every enumerated-population AC in the corpus
  is written, not just these two.

## ⛔ That residual FIRED, same session, before phase 1 merged

Second revision, recorded because the audit trail is the whole point:

- **AC-FALS-12** — `verify.command` WIDENED by one path,
  `packages/lore/tests/unit/service/ac-service.test.ts` appended to the existing 8-file vitest
  invocation. Statement unchanged.
- **What produced it.** Phase 1's implementer ran a full cross-runner sweep and found two genuine
  regressions in that file — stale exact-`toEqual` assertions that did not expect the new
  `recorded_at` key. The file was in NEITHER the task's 21 anchors NOR AC-FALS-12's frozen
  enumeration, so a green AC-FALS-12 coexisted with a real red. Exactly the residual named above,
  realised.
- **Why this is a correction, not a weakening.** The command gained a file; it lost nothing. Every
  previously-enumerated file is still run, still unfiltered. A criterion whose population grows
  can only become harder to satisfy.
- **Cost, so the ordering lesson is not free.** The `ac set` that widened it reset the spec from
  `approved` to `draft`, and the follow-up dispatch was refused by `lore claim` with
  `UPSTREAM_NOT_APPROVED`. ⛔ Edit governance docs BEFORE dispatching, then re-read their status —
  never after. Full analysis: `knowledge-three-of-lore-s-own-outputs-misled-this-session-a` §F5.
- The residual itself remains OPEN and unclosed; widening one enumeration does not fix frozen
  enumerations as a class.

## Phase 1 outcome — measured on merged `main` @ `8f341abe`

`lore verify` attested 13/13 criteria (AC-FALS-11…23), exit 0. Full suites on the merged tree:
vitest 480 files / 8542 passed / 4 skipped, exit 0; bun 1866 pass / 0 fail, exit 0.
`bun run typecheck` exit 0 with no build cache in play (repo has no turbo/nx).

Corpus-wide state migration, measured pre- and post-merge over all 138 specs:

| State | pre | post |
|---|---|---|
| `attested_pass` | 579 | 579 |
| `none` | 39 | 39 |
| `pass_unfalsified` | 29 | 29 |
| `pass` | 15 | 15 |
| `fail` | 62 | **4** |
| `fail_superseded` | — | **58** |

62 = 4 + 58, every other bucket unmoved, and `not_measured` occurs 0 times (production facts always
carry a numeric `falsified`). ⛔ The four remaining `fail` criteria are real corpus red unrelated to
this plan: `AC-061-7`, `AC-062-3`, `AC-062-5`, `AC-064-7`.

⛔ This measurement also RETRACTED the figure that justified the governing spec's report-only
non-goal: `pass_unfalsified` is 29/724 (4.0%), not the recorded 574/700 (82.0%). See the spec's
Out-of-scope section and the retro §F6 — arming the gate is now an open human decision.

# Phases

1. **`derivation`** — planned as one task; ended as **two**. The state widening, the full consumer
   ripple, every stale assertion, and the 4 `falsified` typecheck errors. ⛔ Splitting the ripple
   from the derivation is precisely what D3 rejects, so the main task is deliberately one large
   task and not several small ones.
   - A SECOND task was added to this phase mid-flight, after the main task merged:
     `task-add-the-recorded-at-field-to-two-stale-exact-toequal`. It exists because the frozen-
     enumeration residual fired — two stale exact-`toEqual` assertions in
     `packages/lore/tests/unit/service/ac-service.test.ts` went red on merged `main` while
     AC-FALS-12 stayed green, because that file was in neither the anchor set nor the criterion's
     file list. ⛔ It was NOT foreseen at planning time; it is the measured cost of the residual
     accepted above, and its `ac_scope` is AC-FALS-12 alone. Attested by the AC-FALS-12 run in the
     13/13 and 2/2 figures below — it declares no criterion of its own.
   - So the plan closes with **three** archived tasks, not two.
2. **`typecheck-sweep`** — one task, strictly after phase 1. The 46 pre-existing strictness
   errors in the dashboard test tree, and wiring the tests project into `bun run typecheck`.
   ⛔ Sequential, not parallel — and the binding reason is causal, not merely anchor overlap:
   phase 1's `exclude` fix is what makes those 46 errors resolve at all, so phase 2 has nothing
   to work on before it lands. The shared `tsconfig.tests.json` anchor is what makes the claim
   gate enforce that ordering mechanically.

# Close-out — measured on merged `main` @ `14d77fec`

Three tasks, all archived. `lore verify` attested every criterion in scope: 13/13 for phase 1
(AC-FALS-11…23) and 2/2 for phase 2 (AC-FALS-11, AC-FALS-24), exit 0 both runs.

Full suites on the merged tree, run once from the main checkout with no build cache in play (this
repo has no turbo/nx, so the workspace-prefixed output is bun's own, not a cache replay):
`bun run typecheck` exit 0 / 0 errors; vitest 480 files, 8543 passed, 4 skipped, exit 0; bun 1866
pass, 0 fail, exit 0.

## The guard rail was proven by a make-it-red control, not by exit 0

`bunx tsc -p packages/dashboard/tsconfig.tests.json --noEmit --listFilesOnly` resolves 64 files
under `packages/dashboard/tests/` (it resolved ZERO before this plan). A deliberate probe file
declaring an `AcCoverageFact` without `falsified` makes that project exit **2** with
`TS2741: Property 'falsified' is missing`. ⛔ Exit 0 alone would have been indistinguishable from
checking nothing — which is exactly how the inert config went unnoticed in the first place.

## THIRD in-flight AC revision — AC-FALS-13, and this one came from `lore assess`

`lore assess` returned **partially_met, 78/100**, with a single `evidence_integrity: major` gap:
AC-FALS-12 and AC-FALS-13 use frozen file enumerations as their whole oracle; that method
demonstrably failed inside this slice; and **AC-FALS-13 was never re-validated by discovery after
the failure.** That criticism was correct and had not been acted on.

Discovery run in response — `grep -rln "AcCoverageFact\|deriveAcCoverageState\|computeAcCoverage\|EvidenceRefLite" --include="*.bun.test.ts" packages/`:

| Source | Files |
|---|---|
| discovered by content | `ac-list-falsified.bun.test.ts`, `cli-ac-coverage-badge.bun.test.ts` |
| AC-FALS-13 declared | `cli-ac-coverage-badge.bun.test.ts`, `cli-feed-task-start.bun.test.ts`, `dashboard-assets-loader.bun.test.ts` |

⛔ `ac-list-falsified.bun.test.ts` was MISSING — one of only two bun files naming the derivation,
absent from the criterion that claims to cover "every bun-runner consumer". The widened
4-file invocation was run FIRST and measured green (`49 pass, 0 fail`, exit 0) before the
criterion was edited, so no red was ever converted to green by the edit. Statement unchanged;
the command gained one path and lost none.

⛔ Note the asymmetry that makes content-grep insufficient on its own: `cli-feed-task-start` and
`dashboard-assets-loader` name none of those symbols — they exercise the derivation through a
spawned CLI. So the correct population is the UNION of content-discovery and subprocess reasoning,
and neither method alone is sound. The residual is narrowed, ⛔ not closed.

## The plan-close hint contradiction, now observed as a matched pair

Both of these fired on this plan, minutes apart, about the same command:

- `lore done`: *"the plan-close gate **will evaluate** it once you run: `lore set <plan> --status archived`"*
- `lore status --check-tree`: *"The plan-close gate **never evaluated** it. Run: `lore set <plan> --status archived`"*

A controlled experiment in a throwaway corpus settled it: that command evaluates NO gate, and it
cascade-archives non-terminal children irreversibly. This plan is safe to close that way only
because all three children were already terminal. Full analysis:
`knowledge-three-of-lore-s-own-outputs-misled-this-session-a` §F1.

## Spec anchors declared at close (they were absent)

The governing spec carried `code_anchors: null` through its entire first slice. 14 anchors are now
declared — the four derivation symbols, three consumer call sites, and six test-identity files —
and `lore status --check-drift` reports `consistent (87 specs checked)`, exit 0.

⛔ One anchor was rejected and removed rather than kept: `ac.ts#passUnfalsifiedMarker` reported
`symbol_missing`. Investigated instead of trusting the suggested fix — the function exists at
`ac.ts:506` but is NOT exported, and the anchor mechanism only addresses exported symbols. A
private helper can therefore be anchored at FILE granularity only. That is a true positive, not
one of the scanner's documented false-positive forms.
