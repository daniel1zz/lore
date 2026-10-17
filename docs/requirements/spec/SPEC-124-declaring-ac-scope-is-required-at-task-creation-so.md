---
id: SPEC-124
type: spec
role: spec
title: "Declaring ac_scope is required at task creation, so the runner-attested evidence path is reachable by construction"
status: draft
priority: medium
created: 2026-08-01
updated: 2026-10-17
tags: []
---
## Overview

`lore verify` is the only surface that produces runner-attested evidence, and it REFUSES a task
whose `extra.ac_scope` is absent. Nothing at authoring time requires the declaration. The result
is a reachability hole, not a strictness setting: a task authored without `ac_scope` can never
reach the attested path at all, and the omission is invisible until close-out.

Measured 2026-07-31: all 10 tasks of that session's two waves were authored without `ac_scope`;
all 21 script-mode ACs were consequently recorded through `lore evidence` (self-reported); all
four plan assessments independently reported `attested_evidence_ratio = 0.00`. The wave's own
new gate blocked the wave's own attestation path. Recovery cost four plans a manual
`--task` + explicit `--ac` sweep (`knowledge-recovering-attestation-on-an-already-archived-plan`).

The root cause is authoring-time. This spec closes it there.

## Scope

**In scope.** A commit-time admission rule at task creation: when the task's parent plan resolves
to a spec-tier ancestor declaring at least one script-mode acceptance criterion, the task must
declare `extra.ac_scope` — a possibly-empty array — or creation is refused naming the flag.

**Out of scope.** Changing `lore verify`'s three-valued refusal contract
(`spec-declared-scope-attestation-contract-task-owned-ac-scope` D2 owns it, and its ABSENT +
explicit `--ac` escape must keep working — it is the sole recovery path for the back-catalogue).
Changing the `plan-close` attestation floor. Retro-declaring scope on archived tasks.

## Measured Gap

Two independent measurements refute the premise that `--adhoc` tasks are "exempt by construction
because they have no plan and therefore no spec":

1. `task-ac-ll-8-guards-the-loader-strip-not-the-no-sync-bearing` is an adhoc task (parent = root
   PRD, `plan_id: None`) implementing `AC-LL-10` of
   `spec-eager-libsql-load-makes-every-command-depend-on-a-healthy`. An adhoc task CAN have a
   governing spec and a named criterion.
2. `lore evidence <that-task> --ac AC-LL-10` was nonetheless rejected with
   `Expected a plan document; got type 'prd'` — the resolver walks task → parent expecting a plan.

So the adhoc state was *unreachable*, not *not applicable*. Since then `VerifyRunnerService.verifyAdhocTask`
(2026-08-01) resolves an adhoc task's governing spec by finding the ONE spec whose
`acceptance_criteria` fully covers the task's declared `ac_scope`, refusing loud on zero or
multiple matches. An adhoc task therefore now *depends on* `ac_scope` to be verifiable at all.

## Options Considered

**Option A — Zod validation in `CreateDocInput`.** Rejected: it cannot read the parent plan's
spec ancestor (cross-entity), gets no feeding pack, and does not compose with the service-layer
`GateEnforcer` that CLI/MCP/HTTP already share.

**Option B — a `checkpointRegistry` predicate (`task-create`).** Chosen. Composes with the
existing enforcement at all three adapters, inherits `lore feed task-create` for free, and its
denial is auditable like every other gate.

**Option C — require it only at claim time.** Rejected: the task exists by then and the omission
has already propagated into dispatch bundles; authoring time is where the author still has the
spec in hand.

## Design Decisions

- **D1 — The trigger is the parent plan's spec-tier ancestor declaring >= 1 SCRIPT-MODE criterion.**
  `ai`/`human`-mode criteria are not runner-attestable, so demanding a scope for them would be
  friction with no attestation payoff. A plan with no spec-tier ancestor passes vacuously, exactly
  as `task-claim` already does.
- **D2 — An EMPTY `ac_scope: []` satisfies the rule.** It is an explicit un-declaration ("this task
  claims no criterion"), already a distinct state from absent throughout the verify contract. The
  rule demands a DECISION, never a non-empty claim. There is deliberately no exemption flag: an
  author who believes the task claims nothing says so in one character of syntax.
- **D3 — `--adhoc` tasks are NOT-APPLICABLE, never EXEMPT, and the spec says so explicitly.** The
  predicate keys on the parent plan's spec ancestor; an adhoc task has no parent plan, so the
  trigger never fires — this is vacuous non-application, the same shape as a plan without a spec
  ancestor. ⛔ It must NOT be written as an exemption: an adhoc task that wants attested evidence
  still needs `ac_scope`, because `verifyAdhocTask` resolves its governing spec THROUGH that field.
  Wording this as "adhoc is exempt" would tell authors the opposite of what they must do.
- **D4 — Retroactive policy is settled in this same slice, per
  `adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`.** The rule binds at CREATE only;
  it never re-evaluates existing tasks, so the back-catalogue does not land in violation. Legacy
  verification stays open through the existing ABSENT + explicit `--ac` escape (D2 of the
  declared-scope contract). ⛔ No sweep that retro-declares `ac_scope` on existing tasks: a scope
  authored after the fact to satisfy a predicate is afterwards indistinguishable from one the
  author actually reasoned about.
- **D5 — The refusal names the flag and the criteria the author may choose from.** A refusal that
  says only "ac_scope required" makes the author go hunting for legal ids. It must print the
  governing spec's script-mode criterion ids, so the fix is a copy-paste rather than a query.

## Acceptance Criteria

Every criterion below is script-mode and asserts a stored state or an exit code, never a
reviewer's reading.

- **AC-ACS-1 (NEGATIVE)**: creating a task under a plan whose spec declares >= 1 script-mode AC,
  with no `--ac-scope`, is REFUSED, and the message contains the literal `--ac-scope`.
- **AC-ACS-2 (HAPPY)**: the same creation WITH `--ac-scope` succeeds and the stored
  `extra.ac_scope` equals exactly the ids passed.
- **AC-ACS-3 (BOUNDARY)**: `--ac-scope` with an explicit empty value succeeds and stores an EMPTY
  array — distinct from absent, per D2.
- **AC-ACS-4 (NEGATIVE / no new friction)**: a plan whose spec declares only `ai`/`human`-mode
  criteria, or no criteria, accepts a task with no `--ac-scope` (D1 vacuous pass).
- **AC-ACS-5 (STATE)**: an `--adhoc` task with no `--ac-scope` is created successfully — the
  predicate does not fire without a parent plan (D3).
- **AC-ACS-6 (REGRESSION)**: the existing `lore verify` ABSENT-`ac_scope` + explicit `--ac` escape
  still runs the named ids and still writes runner-attested evidence — the back-catalogue recovery
  path is untouched (D4).
- **AC-ACS-7 (ERROR)**: the refusal message enumerates the governing spec's script-mode criterion
  ids (D5).
- **AC-ACS-8 (HAPPY / end-to-end, the whole point)**: a task created under this rule is verified by
  `lore verify <plan>` and the resulting evidence entry carries an `attestation` block — asserted
  on the STORED entry, never on a zero exit code alone.


## Acceptance Criteria (structured)

- [⚑] [script] AC-ACS-1: Creating a task under a plan whose spec declares at least one script-mode AC, with no --ac-scope, is refused and the message contains the literal --ac-scope.
  script: test — bunx vitest run packages/lore/tests/integration/cli/create-task-ac-scope.test.ts
- [⚑] [script] AC-ACS-2: The same creation with --ac-scope succeeds and the stored extra.ac_scope equals exactly the ids passed.
  script: test — bunx vitest run packages/lore/tests/integration/cli/create-task-ac-scope.test.ts
- [⚑] [script] AC-ACS-3: An explicitly empty --ac-scope succeeds and stores an EMPTY array, a state distinct from absent.
  script: test — bunx vitest run packages/lore/tests/integration/cli/create-task-ac-scope.test.ts
- [⚑] [script] AC-ACS-4: A plan whose spec declares only ai/human-mode criteria, or none, accepts a task with no --ac-scope: the predicate passes vacuously and adds no friction.
  script: test — bunx vitest run packages/lore/tests/integration/cli/create-task-ac-scope.test.ts
- [⚑] [script] AC-ACS-5: An --adhoc task with NO --ac-scope is REFUSED at exit 4, and the same call with --ac-scope "" exits 0 storing an EMPTY array: the ad-hoc branch is BOUND by the requiredness rule, keyed on the author's flag at the CLI layer rather than on a parent plan's spec. Reverses this criterion's original not-applicable-never-exempt reading, superseded 2026-08-03 by task-an-ad-hoc-task-can-never-reach-the-attestation-path-that — the old reading described a trigger that could never fire, which is what made --override-attestation routine for the dominant task shape.
  script: test — bunx vitest run packages/lore/tests/integration/cli/create-task-ac-scope.test.ts
- [⚑] [script] AC-ACS-7: The refusal enumerates the governing spec's script-mode criterion ids so the author can copy one rather than query for legal values.
  script: test — bunx vitest run packages/lore/tests/integration/cli/create-task-ac-scope.test.ts
- [⚑] [script] AC-ACS-6: REGRESSION: lore verify with an ABSENT ac_scope plus an explicit --ac still runs the named ids and still writes runner-attested evidence, keeping the back-catalogue recovery path open.
  script: e2e — bunx --bun vitest run packages/lore/tests/integration/cli/create-task-ac-scope-e2e.bun.test.ts
- [⚑] [script] AC-ACS-8: End-to-end: a task created under this rule is verified by lore verify and the resulting STORED evidence entry carries an attestation block, asserted on the entry itself rather than on a zero exit code.
  script: e2e — bunx --bun vitest run packages/lore/tests/integration/cli/create-task-ac-scope-e2e.bun.test.ts
