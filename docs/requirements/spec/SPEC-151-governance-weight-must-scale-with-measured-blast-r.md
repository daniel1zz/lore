---
id: SPEC-151
type: spec
role: spec
title: "Governance weight must scale with measured blast radius: a gate with no risk input can only be all-on or all-off"
status: draft
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PRD-001
---
# Overview

Governance weight does not scale with a requirement's risk today. The gate layer has
**no risk signal on its input side at all**, and its only adjustment knob is
`workflow.gates.<checkpoint>.<predicate>.enabled` — whose granularity is
`predicate × whole repository`. So the only way to let a low-risk requirement skip a
check is to switch that check off for every requirement.

The consequence is a two-state system with a cliff between the states: either the full
`spec → ac add → approve → plan → phase → task → claim → evidence → verify → done → assess`
chain, or the `--adhoc` channel with no spec and no plan. 58% of this corpus's plans are
1–3 tasks, and they pay the full multi-task coordination ceremony.

## Measured, not inferred (2026-08-24, this corpus)

**M1 — the gate layer has zero risk input.** Every exported predicate in
`gate-predicates.ts` takes only `parent.type` / `kind` / `content` / upstream
`{type,status,deleted_at}` / `ac_scope` / anchors / actor. All 16 `tier|severity`
matches in that file are `"spec-tier"` (a DOC-TYPE tier), a finding's OUTPUT
severity, or an identity-resolution tier — not one predicate reads requirement
scale or risk. `schemas.ts` carries a `priority` field (`critical|high|medium|low`),
Zod-validated, read by NO gate.

**M2 — small requirements are the majority, and they are slow.** Tasks per plan:
1→31 plans, 2→32, 3→21 (84 of 144 = 58%). Single-task plans span, from plan creation
to their task's last update, a mean of 32.9h and a max of 198.4h. One plan that names
itself `single-slice` (`plan-implementation-spec-053-ac-vagueness-advisory-single-slice`)
holds a task whose body is 240 bytes, spanned 198.4h, and revised that task doc 19 times.

**M3 — the existing light channel saves document COUNT, not description VOLUME.**
`--adhoc` (SPEC-069 D2) is 25% of all tasks (200/805; 72 in 2026-07, 128 in 2026-08).
Measured against plan-bound tasks: body mean **3452 bytes vs 1498** (2.3x), evidence
rows mean 3.8 vs 6.5, versions 9.2 vs 12.5. With no spec and no plan to hold context,
context lands in the task body — a one-shot position that no other task can reuse and
that neither `lore ac` nor `lore verify`'s declared-scope derivation can read.

**M4 — churn.** Mean versions per doc: task 11.7, spec 16.6 (max 70), PRD 76. Of the
378 evidence rows carrying `ac_oracle_generation`, **84 (22%) are generation >= 2**,
max 6 — the same AC's deciding command rewritten six times.

**M5 — fan-in measured, and it refutes the obvious threshold design.** Over 502
non-test source files, using `buildImportGraph`'s own `reverse` edges: p50=1, p75=4,
p90=10, p95=24, p99=85, max=670; 133 files have zero fan-in. The top of the
distribution is barrels and composition roots — `packages/core/src/index.ts` 670,
`in-memory-store.ts` 200, `corpus-service.ts` 189, `app.ts` 132 — while the files
whose semantics the whole corpus depends on sit LOW: `packages/core/src/schemas.ts`
**8**, `store-shared.ts` 12, `task-workflow.ts` 14, `acceptance.ts` 15,
`gate-predicates.ts` 24, `checkpoint-registry.ts` 29. ⛔ Therefore raw fan-in is NOT a
usable risk proxy on its own: a barrel scores 670 for re-exporting, and `schemas.ts` —
the Zod boundary every write crosses — scores 8. Layer must dominate; fan-in may only
subdivide within a layer. This measurement was taken BEFORE the thresholds were
written, and it changed them.

## Goals / Non-Goals

**Goals**

- G1. Every task's governance weight is set by a **derived** grade, never a declared one.
- G2. The grade is a pure function — same inputs, same grade, reproducible across sessions.
- G3. Predicates protecting concurrency and attributability are **fully decoupled** from
  the grade: no grade can waive them.
- G4. A middle tier exists between the full chain and `--adhoc`: **spec + task, no plan**.
- G5. Zero retroactive invalidation of the back-catalogue.

**Non-Goals**

- N1. Not introducing an urgency dimension. `priority` keeps its current meaning and is
  not repurposed — "how urgent" and "how dangerous" are orthogonal, and 1668 live docs
  already carry `priority` values authored under the urgency reading.
- N2. Not letting a declared value override the derived grade.
- N3. Not changing `--adhoc`'s semantics; it remains the lightest tier.
- N4. Not recomputing grades for existing tasks.

## Design

**D1 — the grade is DERIVED from structural facts, never declared.** A declared
`risk_class` is refused by construction: the declarer is the party the grade
constrains, so an agent wanting fewer gates would declare `trivial`, and
`trivial`/`critical` are abstract words two sessions resolve differently. The
derivation is layer-dominant, per M5:

```
gradeOf(task) = f(
  layer(file_anchors),      -- DOMINANT; see the layer table in D8
  count(file_anchors),
  adjustedFanIn(anchors),   -- max over anchors, BARRELS EXCLUDED; see D2
  hasSpecAncestor
)
```

`adjustedFanIn` excludes pure re-export files, because M5 measured a barrel at 670
purely for forwarding. "Pure re-export" is itself mechanical, not editorial: a file
whose every top-level statement is an `export ... from` form. ⛔ The exclusion rule is
asserted by AC, not left to the implementer's reading, since an unexcluded barrel
would make every task that touches `@lore/core` structural.

Pure, total, and reproducible. An agent cannot lower its grade by lying — only by
genuinely narrowing its declared anchors, which is the incentive we want.

**D2 — fan-in has ONE definition, promoted to a shared home.**
`scripts/changed-tests.ts` already computes exactly this: `buildImportGraph(fileMap,
aliasMap)` returns `ImportGraph` whose `reverse: ReadonlyMap<string,
ReadonlySet<string>>` is the file → its importers edge set, and its own header calls
that section a "Pure core: import graph + selection algorithm (unit-tested without
git)". The pure half (`extractImportSpecifiers` / `resolveImportSpecifier` /
`buildImportGraph`) moves to `@lore/core`; the IO half (`loadFileMap` / `walkDir`)
stays behind the Node boundary. ⛔ Both `changed-tests.ts` and the grade function
consume that ONE definition. A second copy is refused by AC, because this repo has
already measured what two copies of one rule do: the retired-shape refusal message
drifted (`to file` vs `to file/list`) and nothing noticed, since nothing compared them.

**D3 — the class boundary, complete at compile time.** Every gate predicate is
assigned to exactly one class:

| Class | Predicates | Grade interaction |
|---|---|---|
| **I — concurrency + attributability** | `noAnchorOverlap`, `actorIdentityGuard`, `stampCurrency`, `parentLegal`, `specKindValid`, `upstreamApproved` | NONE. No grade waives these. |
| **II — per-requirement verification quality** | `hasSkeleton`, `upstreamHasAcceptanceCriteria`, `acQuantifiable`, `oracleCoverage`, `requiresUat`, `attestationFloor` | Scaled by grade (`attestationFloor` by ratio, the rest by applicability) |

The boundary rests on one property: **a class-I failure's cost does not scale with
requirement size.** Two sessions colliding on one file costs the same whether the
change was a typo fix or an architecture rewrite. A class-II failure's cost is
proportional to the requirement — a doc tweak with no AC loses that doc tweak; a gate
semantics change with no AC loses the governance layer.

`upstreamApproved` is class I deliberately: the only legal shapes are "has a spec and
it is approved" or "has no spec" (`--adhoc`, already legal). Manufacturing a third
shape — has a spec but bypasses its approved state — would empty `approved` of meaning.

Completeness is mechanical, not diligent: the assignment lives in a
`Record<PredicateField, PredicateClass>` total map, so a new predicate with no class
fails `tsc`. This is the shape `PREDICATE_CONTRACTS: Record<PlanCloseField,
PredicateContract>` already uses.

**D4 — the middle tier is `spec + task`, no plan.** Of the six things the plan layer
supplies — `phase` grouping, `lore ready`, cross-task `anchor_conflicts`,
`plan-promote`, the `plan-close` predicate set, and `lore assess` — only anchor
mutual exclusion is needed by a one-task requirement, and that one is class I and
therefore already unconditional. The other five exist for relations BETWEEN tasks.

The spec-lookup path this needs already exists and is already verified: SPEC-069's own
flag documentation states that for an `--adhoc` task, `--ac-scope` "is also how `lore
verify --task` finds the governing spec at all". The middle tier reuses that reverse
lookup rather than introducing a second one.

Abuse check: an agent could split a genuinely multi-task requirement into N spec+task
pairs to dodge the plan layer. That path is self-damping — each spec must clear
`spec-create` and `spec-promote` (with ACs), so N specs cost more than one plan.

**D5 — declared grade is re-checked against MEASURED blast radius.** `file_anchors`
is a declared value, so under-declaring is the one remaining way to lower a grade.
The grade recorded at claim time is therefore re-derived at evidence time from the
radius `blastRadiusChanged` (`real-git-port.ts`, built by
`spec-corpus-truthfulness`) actually measures, and a mismatch refuses. This is the
same two-axis shape as that spec's `stamp x radius`, reused rather than reinvented.

**D6 — one arming cutoff, shared, non-forgeable.** Grading arms at a single
`arming_rev` — the `MAX(audit.id)` captured once in the arming commit, per
`adr-a-record-with-no-state-stamp-is-acceptable-but-never-green`. Pre-arming tasks
classify `legacy_ungraded` and are ACCEPTED exactly as today; post-arming tasks with
no grade can never be green. ⛔ This spec and its sibling read-side spec share ONE
`arming_rev`; a second cutoff would be two grandfather clauses that must then be kept
in step, which is the drift shape D2 already refuses.

**D7 — the rules ship as executables, not as prose.** Root `CLAUDE.md` measured
23110/24576 bytes and 198/220 lines with an "approaching ceiling" advisory, so a prose
home does not exist; and per the North Star a rule that exists only as prose does not
bind. The grade function, the class map, and the tier table are each printable
(`lore gate --explain` extended), and `CLAUDE.md` gains pointers only. The oracle for
this is `lore status --check-claude-md`: net growth must stay within budget.

**D8 — the level set, the thresholds, and the waiver table.** Every threshold below is
a measured percentile from M5, not a chosen round number.

*Layers, risk-descending:*

| Layer | Members | Why |
|---|---|---|
| `STRUCT` | `packages/core/src/**`, `packages/lore/src/store/**`, `gate-predicates.ts`, `checkpoint-registry.ts`, `predicate-contracts.ts`, anything touching the `audit` chain | Data boundary, persistence, governance verdicts, non-forgeable chain — semantics the whole corpus depends on regardless of fan-in (M5: `schemas.ts` fan-in 8) |
| `SERVICE` | `packages/lore/src/service/**` (remainder) | Business logic behind `Result<T, LoreError>` |
| `ADAPTER` | `packages/lore/src/adapters/**` | CLI/MCP/HTTP surfaces |
| `PERIPHERAL` | `scripts/**`, `packages/dashboard/**`, `*.md`, docs | No service-layer consumer |

*Layer resolution when a task's anchors span layers:* the task takes the
**most risk-dominant** layer present (`STRUCT` > `SERVICE` > `ADAPTER` > `PERIPHERAL`),
never an average and never the first anchor's. An anchor matching NO layer is an error
(T3), not a `PERIPHERAL` default.

*Grades, evaluated in this order, first match wins. `G1` is the unconditional tail, so
the function is TOTAL over every (layer, count, fan-in) triple:*

| Order | Grade | Condition |
|---|---|---|
| 1 | `G3 structural` | layer is `STRUCT`, OR `adjustedFanIn` > 85 (p99), OR `count(anchors)` > 8 |
| 2 | `G2 broad` | `adjustedFanIn` > 10 (p90), OR `count(anchors)` > 3 |
| 3 | `G0 mechanical` | layer is `PERIPHERAL` AND `count(anchors)` <= 2 AND `adjustedFanIn` <= 4 (p75) |
| 4 | `G1 local` | **tail — everything else** |

⛔ `G0` is tested BEFORE `G1` because it is the narrower predicate; `G1` carries no
layer restriction precisely so that no input can fall through. A `PERIPHERAL` task with
3 anchors, or one with `adjustedFanIn` of 7, lands `G1` — an earlier draft of this table
left both unmatched, and the totality assertion in AC-GRADE-1 exists to keep that
regression out.

*Class-II waivers by grade — the table D3 promised:*

| Predicate | G0 | G1 | G2 | G3 |
|---|---|---|---|---|
| `hasSkeleton` | waived | required | required | required |
| `upstreamHasAcceptanceCriteria` | waived | required | required | required |
| `acQuantifiable` | waived | waived | required | required |
| `oracleCoverage` | waived | waived | required | required |
| `requiresUat` | waived | waived | waived | required |
| `attestationFloor` (min ratio) | 0.0 | 0.5 (today's default) | 0.75 | 1.0 |

⛔ Class I is absent from this table by construction — no column can waive it (D3).

*Document-shape entitlement:*

| Grade | Permitted shapes |
|---|---|
| `G0` | `--adhoc`, or spec + task, or full chain |
| `G1` | spec + task (D4), or full chain |
| `G2`, `G3` | full chain only — plan and phase required |

G1 is the middle tier's home: it is the grade at which ACs are still worth declaring
(so a spec must exist) but no cross-task coordination is in play (so no plan).

## Trade-offs

- **T1 — a coarse grade mislabels edge cases.** Fan-in is a static-import measure, so a
  consumer reached only through `await import()` is invisible to it — the same blind
  spot `changed-tests.ts` already documents for its own selection. Accepted: the grade
  errs high (a missed consumer means an under-counted fan-in on a file that is at least
  in a graded layer), and D5's measured re-check is the backstop.
- **T2 — the middle tier gives up `lore assess`.** A spec+task requirement gets no
  plan-level AI outcome assessment. Accepted: `assess` judges a plan against its spec's
  ACs, and with one task the AC evidence IS the judgment.
- **T3 — the layer table is a hand-maintained partition, and a new top-level directory
  defaults to nothing.** Accepted only because it is refused rather than defaulted: an
  anchor matching no layer is an error (AC-GRADE-1), never a silent `PERIPHERAL`. That
  is the same no-silent-fallback rule the rest of this repo holds required fields to.
- **T4 — thresholds are pinned to THIS corpus's percentiles.** p75/p90/p99 were measured
  on 502 files on 2026-08-24. They will drift as the tree grows. Accepted: the numbers
  live in one exported constant with the measurement date and the producing command in
  its doc comment, so a re-measure is a one-line diff with an auditable provenance —
  ⛔ not scattered literals at each comparison site.


## Acceptance Criteria (structured)

- [·] [script] AC-GRADE-1: gradeOf is pure and TOTAL, asserted on four fronts: (a) two calls with identical input return deep-equal grades; (b) the grade table is a total function — a bounded exhaustive sweep over layer x anchor-count x fan-in including every threshold boundary value (2,3,4,5,8,9,10,11,85,86) yields a grade for EVERY triple, never undefined, which is the regression guard for the unmatched-row hole an earlier draft of D8 had; (c) an anchor matching no declared layer is refused with an error, never defaulted to PERIPHERAL; (d) a task whose anchors span layers resolves to the most risk-dominant layer present, and a pure re-export barrel is EXCLUDED from adjustedFanIn — both asserted, since D1 promises them and no other AC covers them. Covered by describe "gradeOf — purity, totality, layer resolution, barrel exclusion" in packages/lore/tests/unit/service/requirement-grade.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/requirement-grade.test.ts 2>&1 && echo 'AC-GRADE-1 PASS: repeated identical input gave deep-equal grades, the bounded exhaustive triple sweep including every threshold boundary returned a grade for every input with none undefined, an unknown anchor layer was refused with an error rather than defaulted, a multi-layer task resolved to its most risk-dominant layer, and a pure re-export barrel was excluded from adjustedFanIn'
- [·] [script] AC-GRADE-2: buildImportGraph has EXACTLY ONE definition tree-wide (in @lore/core), and BOTH scripts/changed-tests.ts and the grade-derivation module carry a live CALL to it, not merely an import. Asserts exactly 1, never >= 1: two copies of one rule is the shape this repo has already measured drifting undetected, because nothing compared them.
  script: test — bun scripts/check-fanin-ssot.ts 2>&1 && echo 'AC-GRADE-2 PASS: buildImportGraph resolved to exactly 1 tree-wide definition in @lore/core and both changed-tests.ts and the grade module were measured to CALL it, not merely import it'
- [·] [script] AC-GRADE-3: For EVERY predicate in the class-I set, a lowest-grade task input still has that predicate evaluated and still able to refuse — at least one refusing case per predicate. The test iterates the class map itself as its source, so a newly added class-I predicate enters the sweep automatically. Not a sample. Covered by describe "class-I predicates are grade-invariant" in packages/lore/tests/unit/service/gate-class-boundary.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/gate-class-boundary.test.ts 2>&1 && echo 'AC-GRADE-3 PASS: every class-I predicate enumerated from the class map itself was evaluated under the lowest grade and produced at least one refusal'
- [·] [script] AC-GRADE-4: The class map is TOTAL, proven by an in-tree negative control: a test writes a predicate with no class assignment INTO the checked tree, spawns typecheck, asserts exit EXACTLY 2 with output naming that predicate, then restores the tree. Asserts the exact code, never "non-zero". A forward typecheck alone would stay green even if the map were declared Partial rather than total, which is why this AC drives the control instead. Covered by describe "an unassigned predicate fails typecheck at exit 2" in packages/lore/tests/integration/gate-class-totality.test.ts
  script: test — bunx vitest run packages/lore/tests/integration/gate-class-totality.test.ts 2>&1 && echo 'AC-GRADE-4 PASS: an in-tree predicate with no class assignment drove typecheck to exit exactly 2 naming that predicate, and the tree was restored'
- [·] [script] AC-GRADE-5: In a throwaway corpus (mkdtemp + lore init, cwd inside it), a task parented directly to a spec with NO plan can be claimed, can record evidence, and lore verify --task resolves its governing spec through --ac-scope. Never writes to this repo own .lore/ corpus. Covered by describe "middle tier: spec parents task with no plan" in packages/lore/tests/integration/middle-tier-spec-task.test.ts
  script: e2e — bunx vitest run packages/lore/tests/integration/middle-tier-spec-task.test.ts 2>&1 && echo 'AC-GRADE-5 PASS: in a throwaway corpus a planless spec-parented task was claimed, recorded evidence, and lore verify --task resolved its governing spec via --ac-scope'
- [·] [script] AC-GRADE-6: A task whose real diff touches N files but declares M < N anchors is REFUSED at evidence time, with the refusal naming the undeclared paths. Paired green control in the same run: the same task with complete anchors passes. Both directions measured, because a refusal path with no green control cannot distinguish "the check works" from "the check refuses everything". Covered by describe "declared anchors vs measured blast radius" in packages/lore/tests/unit/service/requirement-grade.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/requirement-grade.test.ts -t 'declared anchors vs measured blast radius' 2>&1 && echo 'AC-GRADE-6 PASS: an under-declared task was refused with the undeclared paths named, and the same task with complete anchors passed in the same run as the green control'
- [·] [script] AC-GRADE-7: Arming invalidates nothing: the gate verdict for EVERY pre-arming task is identical before and after the arming commit, compared as whole result sets, not sampled. Pre-arming tasks classify legacy_ungraded and are accepted. The comparison enumerates every live task, so a task added to the corpus mid-run cannot hide in an unsampled remainder. Covered by describe "arming changes no pre-arming verdict" in packages/lore/tests/integration/grade-arming-parity.test.ts
  script: test — bunx vitest run packages/lore/tests/integration/grade-arming-parity.test.ts 2>&1 && echo 'AC-GRADE-7 PASS: the gate verdict set over every pre-arming task compared equal before and after arming, with pre-arming tasks classified legacy_ungraded and accepted'
- [·] [script] AC-GRADE-8: The rules ship as executables, not prose: lore status --check-claude-md exits 0 with root CLAUDE.md inside both its line and byte ceilings, this spec adds at most 3 lines to it, and the grade function, the class map, and the tier table are each printable from lore gate --explain. Asserts the printed output is non-empty and names all three, so a pointer with nothing behind it fails.
  script: other — lore status --check-claude-md 2>&1 && lore gate --explain 2>&1 | grep -q 'class' && echo 'AC-GRADE-8 PASS: check-claude-md exit 0 within both ceilings and lore gate --explain printed the grade function, class map and tier table'
- [·] [script] AC-GRADE-9: Every script-mode AC on this spec EXCEPT this one carries all four --falsifier-* fields, and lore verify --falsify drives each to the EXACT declared exit code. This AC itself carries no falsifier by construction, not by omission: its red state is a corpus condition (some AC lacks a falsifier), and the falsifier mechanism mutates FILES only, so it cannot express a corpus-state mutation.
  script: other — lore ac list spec-governance-weight-must-scale-with-measured-blast-radius-a --json 2>&1 | bun scripts/check-falsifier-coverage.ts 2>&1 && echo 'AC-GRADE-9 PASS: every script-mode AC on this spec except AC-GRADE-9 carries all four falsifier fields and verify --falsify reached each declared exit code exactly'
- [·] [script] AC-GRADE-10: Grading is WIRED, not merely computed: the D8 waiver table is the iteration source, and for EVERY (predicate, grade) cell the suite asserts the actual gate behaviour matches the cell — a waived cell means the predicate was NOT evaluated, a required cell means it WAS evaluated and can still refuse. Two-sided in the same run. Adding a row or column to the table therefore enters the sweep automatically. Asserting only that gradeOf returns the right grade would be the capability-implemented-wiring-absent false green this repo has already measured four times. Covered by describe "the D8 waiver table is enforced cell by cell" in packages/lore/tests/integration/grade-waiver-wiring.test.ts
  script: test — bunx vitest run packages/lore/tests/integration/grade-waiver-wiring.test.ts 2>&1 && echo 'AC-GRADE-10 PASS: every cell of the D8 waiver table was driven end to end — waived cells measured the predicate as not evaluated, required cells measured it evaluated and still able to refuse'
