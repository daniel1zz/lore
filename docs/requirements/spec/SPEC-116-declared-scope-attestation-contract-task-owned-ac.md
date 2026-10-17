---
id: SPEC-116
type: spec
role: spec
title: "Declared-scope attestation contract: task-owned ac_scope, intersection by default, loud refusal on unknown scope"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-10-17
tags: []
links:
  - {id: ADR-018, type: implements}
---
## Overview

Implements `adr-lore-verify-s-attested-evidence-scope-belongs-to-the-task`. That ADR holds the rationale, the four-perspective review, the rejected alternatives and the measured evidence; this spec holds only the buildable contract and its oracles. Read the ADR first — every design decision referenced below as `D<n>` is defined there and must not be re-litigated here.

The defect in one sentence: `lore verify <plan>` with no `--ac` attests every declared script-mode AC onto the single resolved target task, and the coverage conjunct that guards plan-close derives its "claimed" set from those very entries — so the audited evidence defines its own audit scope.

## Scope

In scope:
- `task.extra.ac_scope` as the declared owner of a task's AC claim (D1), **with its own authoring surface** (see Contract Details — a field no surface can author is the recorded "gate demanding a field nobody can write" defect).
- `lore verify`'s selection and refusal behaviour: declared-scope intersection by default, loud refusal on unknown scope, pre-flight refusal on an out-of-scope explicit `--ac` (D2, D3).
- Renaming the evidence-derived set and adding a separate declared-scope fact, with no fallback between them (D4).
- Demoting `attestationFloor` condition 1 from blocking conjunct to reported fact, keeping its computation (D5).
- Recording the measured false-pass shape in the coverage predicate's `known_false_pass` (D6).
- Wiring `assertScopeFreeze` for both the task and phase tiers (D8), at the new writer.

Out of scope:
- Migrating, rewriting or deleting the 128 already-written wide attestations (D7 — append-only; the plan they belong to is archived and is not re-gated).
- Evidence commit provenance (a separate root cause; see the ADR's closing section).
- Any change to `recordVerifiedEvidence`'s injected seam or to `PlanBundle`'s shape — both explicitly preserved by the ADR.

## Contract Details

These are the names and codes this spec FIXES so that no implementer has to invent them (a gap the review judge correctly flagged on v1 of this spec).

**Authoring surface.** `lore scope add|rm|list <task-or-phase> <ac-id>` — a dedicated read-merge-write writer, exactly parallel to `lore anchor add|rm|list`, serving BOTH tiers. `lore create task --ac-scope <id>` (repeatable) authors the field at creation. `lore set` gains NO `--ac-scope` flag: it replaces `extra` wholesale, which is why every structured `extra` field in this codebase has a dedicated writer. `assertScopeFreeze` (D8) is wired HERE — it is the single place a scope array is edited, for tasks and phases alike; its refusal is `VALIDATION_ERROR` (exit 4) carrying the literal already in the codebase, `cannot remove ac_scope id(s) with recorded evidence` (`phase.ts:294`).

**Removing the last id leaves an EMPTY array, never an absent field.** The distinction AC-VS-5 makes contractual is authorial: absent means nobody ever declared a scope, empty means an author declared that this task claims nothing. `lore scope rm` of the final id is an explicit un-declaration and must therefore yield `ac_scope: []`.

**Facts.** `ClaimedAcCoverage.claimed_acs` is renamed `exercised_acs` (evidence-derived, descriptive only). A SEPARATE `DeclaredScopeCoverage` carries:
- `declared_acs: string[]` — union over evidence-bearing tasks of (`task.extra.ac_scope` ∩ the spec's declared script-mode criteria);
- `unattested_acs: string[]` — the subset of `declared_acs` with zero attested entries;
- `scope_undeclared: boolean` — true iff at least one evidence-bearing task carries no `ac_scope`;
- `meets_coverage: boolean` — `unattested_acs` is empty.

The plan-close coverage conjunct reads `DeclaredScopeCoverage`. When `scope_undeclared` is true the conjunct returns the APPLICABILITY verdict — `{notApplicable: true, reason: "scope-undeclared", referent: <plan>}` — never `{ok: true}`. This reuses the exact mechanism the governing ADR's predecessor shipped for `no-evidence`: `GateEnforcer` surfaces it as an advisory plus an audit row, so an undeclared legacy plan is visible AS undeclared rather than indistinguishable from a compliant one. A silent vacuous pass here would reinstate the proxy-for-invariant defect this whole line of work exists to remove.

**Exit codes and pinned message literals.** All FOUR refusal paths are `VALIDATION_ERROR` (exit 4) written to **stderr**, mirroring the existing unknown-AC-id refusal in `verify-runner-service.ts`. Each message must contain the literal below, so the oracles match a fixed string rather than a description of one:
- absent `ac_scope` AND no `--ac` → contains `lore scope add`. (Absent `ac_scope` WITH an explicit `--ac` is NOT a refusal: it runs exactly the named ids — D2's stated escape, and the only sanctioned path for attesting a task authored before this field existed.);
- empty `ac_scope` array → contains `declares no acceptance criterion` (and is therefore not equal to the absent-case message);
- out-of-scope `--ac` → contains every offending id AND every id of the task's declared set;
- populated `ac_scope` intersecting NO criterion on the parent spec → contains `matches none of the acceptance criteria`. A run selecting zero criteria would attest nothing while exiting 0 — the same vacuous-pass shape this contract exists to remove — so it is refused rather than passed.

`known_false_pass` for the coverage predicate must contain the literal `plan-wide run`.

## Acceptance Criteria

Every criterion below is script-mode. The refusal path is assertable through the EXISTING injected `recordVerifiedEvidence` seam (non-invocation), so the core of this work is vitest unit coverage with hand-written doubles — no store and no compiled binary except where the criterion names a CLI surface.

The shared fixture for AC-VS-1/2 is a spec declaring exactly 3 script-mode criteria.

- **AC-VS-1 (HAPPY, D3)**: a default run (no `--ac`) against a task whose `ac_scope` names 2 of the fixture's 3 criteria attests exactly those 2 `ac_ref`s — measured as the recorded set, not as stdout.
- **AC-VS-2 (control for AC-VS-1)**: on the SAME fixture, a task whose `ac_scope` names all 3 attests exactly 3 `ac_ref`s. Two different declared scopes must produce two different counts (2 vs 3); without this, AC-VS-1 cannot distinguish a correct intersection from a runner that executes nothing.
- **AC-VS-3 (NEGATIVE, D2)**: a target task with NO `ac_scope` and no `--ac` exits 4 before executing any command, never invokes the injected recorder, and its stderr names `lore scope add`.
- **AC-VS-4 (NEGATIVE, D3)**: an explicit `--ac` naming an id outside the target's declared scope exits 4 pre-flight — zero commands executed, zero entries written, and stderr contains both the offending id and every id of the task's declared set.
- **AC-VS-5 (BOUNDARY, D1)**: an EMPTY `ac_scope` array exits 4 and stderr contains `declares no acceptance criterion`, a literal absent from AC-VS-3's message — so empty and absent are different states, not one collapsed code path with a cosmetic difference.
- **AC-VS-6 (STATE, D4)**: for a fixture whose tasks carry evidence but declare no scope, `DeclaredScopeCoverage` reports `declared_acs: []` and `scope_undeclared: true` while `exercised_acs` is non-empty — the two fields disagree, which is only possible if neither is computed from the other — AND the coverage conjunct returns `notApplicable` with reason `scope-undeclared`, never `{ok: true}`, so the undeclared fixture cannot pass vacuously.
- **AC-VS-7 (REGRESSION, D5)**: on a TWO-task fixture — task A carrying attested entries covering every declared-scope AC (so condition 2 is satisfied, and A is the source of those attestations), task B carrying evidence entries of which NONE is attested — with no `minRatio` configured (condition 3 not evaluated), so condition 1 is the only conjunct in question: `attestationFloor` returns ok AND the attestation summary lists task B in `zero_attested_tasks` — demoted, not deleted.
- **AC-VS-8 (D6)**: `lore gate plan-close --explain` prints a `known_false_pass` for the coverage predicate containing the literal `plan-wide run`.
- **AC-VS-9 (D8, with its own control)**: `lore scope rm` of an id that already carries evidence exits 4 with stderr containing `cannot remove ac_scope id(s) with recorded evidence`, and the id is still present afterwards — for a task and for a phase; removing a non-evidenced id from the same fixture exits 0 and the id is gone.
- **AC-VS-10 (authoring, HAPPY)**: `lore create task --ac-scope <id>` (repeatable) authors the field and `lore get <task> --json` reports exactly the ids passed.
- **AC-VS-11 (authoring, NEGATIVE)**: after `lore scope add` of one id followed by `lore scope rm` of that same id, `ac_scope` is `[]` (an empty array, NOT an absent key — the terminal state fixed in Contract Details), unrelated `extra` keys are byte-identical to before, and `lore set --ac-scope` exits 2 as an unknown flag.


## Acceptance Criteria (structured)

- [⚑] [script] AC-VS-1: on a 3-criterion fixture a default run against a task whose ac_scope names 2 of them attests exactly those 2 ac_refs, measured as the recorded set not as stdout
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-declared-scope.test.ts -t 'intersection by default'
- [⚑] [script] AC-VS-2: on the SAME fixture a task whose ac_scope names all 3 attests exactly 3 ac_refs, so two declared scopes yield two different counts 2 versus 3
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-declared-scope.test.ts -t 'wider scope executes more'
- [⚑] [script] AC-VS-3: a target task with no ac_scope and no --ac exits 4 before executing any command, never invokes the injected recorder, and stderr names lore scope add
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-declared-scope.test.ts -t 'unknown scope refuses'
- [⚑] [script] AC-VS-10: lore create task --ac-scope repeatable authors the field and lore get --json reports exactly the ids passed
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-scope-writer.bun.test.ts -t 'create task with ac-scope round trip'
- [⚑] [script] AC-VS-4: an explicit --ac naming an id outside the target's declared scope exits 4 pre-flight with zero commands executed, zero entries written, and stderr containing both the offending id and every id of the task's declared set
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-declared-scope.test.ts -t 'out of scope ac refuses preflight'
- [⚑] [script] AC-VS-5: an empty ac_scope array exits 4 and stderr contains the literal 'declares no acceptance criterion', a literal absent from the AC-VS-3 message
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-declared-scope.test.ts -t 'empty scope distinct from absent'
- [⚑] [script] AC-VS-8: lore gate plan-close --explain prints a known_false_pass for the coverage predicate containing the literal 'plan-wide run'
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/plan-close-known-false-pass.bun.test.ts -t 'coverage predicate records its false pass'
- [⚑] [script] AC-VS-6: for a fixture whose tasks carry evidence but declare no scope, DeclaredScopeCoverage reports declared_acs empty and scope_undeclared true while exercised_acs is non-empty, AND the coverage conjunct returns notApplicable with reason scope-undeclared rather than ok, so the undeclared fixture cannot pass vacuously
  script: test — bunx vitest run packages/core/src/evidence-panel.test.ts -t 'exercised versus declared scope'
- [⚑] [script] AC-VS-7: on a two-task fixture where task A carries attested entries covering every declared-scope AC and task B carries evidence of which none is attested, with no minRatio configured, attestationFloor returns ok and the summary lists task B in zero_attested_tasks
  script: test — bunx vitest run packages/lore/tests/unit/service/attestation-floor.test.ts -t 'condition one reported not blocking'
- [⚑] [script] AC-VS-9: lore scope rm of an evidenced id exits 4 with stderr containing 'cannot remove ac_scope id(s) with recorded evidence' and the id still present afterwards, for a task and for a phase, while removing a non-evidenced id from the same fixture exits 0 and the id is gone
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-scope-writer.bun.test.ts -t 'evidenced removal blocked non-evidenced allowed'
- [⚑] [script] AC-VS-11: after lore scope add of one id then lore scope rm of that same id, ac_scope is an empty array and not an absent key, unrelated extra keys are byte-identical, and lore set --ac-scope exits 2 as an unknown flag
  script: e2e — bunx --bun vitest run packages/lore/tests/unit/adapters/cli-scope-writer.bun.test.ts -t 'scope writer round trip and set rejects the flag'

## Code anchors

- packages/core/src/phase.ts
- packages/lore/src/adapters/cli/commands/scope.ts
- packages/core/src/evidence-panel.ts
- packages/lore/src/service/verify-runner-service.ts
- packages/lore/src/service/predicate-contracts.ts
