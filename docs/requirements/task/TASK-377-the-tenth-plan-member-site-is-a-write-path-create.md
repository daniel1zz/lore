---
id: TASK-377
type: task
role: plan
title: "The tenth plan-member site is a WRITE path: create-time extra.phase validation resolves the plan by parent_id while every phase-scoped read resolves it by membership"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Defect — the TENTH plan-member site, and the first one on a WRITE path

Found and documented (not fixed) by `agent:fix-ninth-plan-member` while closing the ninth
site; recorded in `buildGroups`' JSDoc at
`packages/lore/src/service/phase-migration-service.ts:533`.

Two halves of the same phase namespace are resolved by DIFFERENT keys:

- **Create-time `extra.phase` validation** resolves the owning plan from **`parent_id`**
  (the generic validation path in `CorpusService`) — it checks the phase name against
  `plan.extra.phases[]` of whatever doc the task is PARENTED under.
- **`PhaseService.findTasksByPhase`** (`phase-service.ts:371`, used by phase rm/rename at
  `:190`/`:292`) resolves the same namespace by **membership** (`extra.plan_id`).

For a task whose `parent_id` legitimately diverges from its `extra.plan_id` — the SUPPORTED
`lore create task --plan-id P --parent Q` shape (SPEC-065 D4) — the phase name is validated
against the WRONG plan's namespace, while every later phase-scoped read resolves it against
the right one.

# Why this one is different from the previous nine

The nine already-closed sites were all READ paths: a wrong key dropped a member from a
report, and re-running the query after the fix recovered the truth. This one changes a
**write-path validation outcome**: a task that is accepted today may be REFUSED after the
fix, and vice versa. Consequences that must be planned for, not discovered:

1. **The back-catalog is evaluated against the new rule at its next write.** This repo has
   already measured that shape — a newly-armed predicate leaves every pre-existing doc in
   violation the moment it arms
   (`knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`). Budget the sweep AND an
   explicit retroactive policy IN THIS SLICE.
2. **Existing tasks may hold a phase name valid in neither namespace.** Enumerate them before
   changing the predicate; decide per case (accept, migrate, or exempt in writing). Prefer a
   written exemption over rewriting data to satisfy a predicate.
3. ⛔ **Undeclared phase titles are NOT inherently a bug** — the one-shot migration's
   one-group-per-task fallback creates them BY DESIGN (recorded in the same JSDoc). Do not
   "fix" this by making anything refuse data the migration can carry losslessly.

# Required fix

1. Resolve the owning plan for create-time `extra.phase` validation by **membership**
   (`isPlanMember` / `extra.plan_id`), matching every phase-scoped read. Use the shared
   predicate at `packages/lore/src/service/plan-membership.ts` — do not re-implement the
   comparison inline.
2. Enumerate the corpus for tasks whose `parent_id !== extra.plan_id` AND that carry
   `extra.phase`. Report the set BEFORE changing behaviour; that set IS the retroactive
   policy's scope.
3. Ship the retroactive decision in the same slice as the predicate change — either the
   sweep, or a written exemption naming the docs it covers and why.
4. An adhoc task (`extra.adhoc === true`) has no plan membership by design — it must not be
   dragged into either namespace. Assert this explicitly; the previous sweep needed the same
   carve-out.

Distribution surface: binary-side (`packages/lore/**`).

# Acceptance criteria

- **AC-1** — a task created with `--plan-id P --parent Q` (P ≠ Q) validates `extra.phase`
  against **P**'s declared phases. RED first: today it validates against Q's.
- **AC-2** — the mirror case is REFUSED: a phase name declared on Q but not on P must fail
  for that same task. Without this, AC-1 alone is satisfiable by accepting everything.
- **AC-3** — CONTROL: the undiverged case (`parent_id === extra.plan_id`) behaves
  byte-identically to today. This is the overwhelming majority of the corpus.
- **AC-4** — `extra.adhoc` tasks are unaffected in both directions.
- **AC-5** — the enumeration from Required item 2 is recorded (in the task's evidence or a
  corpus doc), and the retroactive decision is written down. An empty result set must be
  asserted as EMPTY, never inferred from a silent report — a zero-count report and a failed
  query are indistinguishable otherwise.
- **AC-6** — CONTROL: `lore phase rm` / `lore phase rename` blocking behaviour is unchanged
  for undiverged tasks, and now agrees with create-time validation for diverged ones.
- **AC-7** — `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection count (loud-zero rule).
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** `parent_id` is the proxy; `extra.plan_id` is the property. An input satisfying the
proxy while violating the property is the supported diverged shape itself — measured, and the
reason for the previous nine fixes. Closes.

**Silence.** The current failure is fully silent: a phase name checked against the wrong
namespace either passes (and a later phase-scoped read cannot find it) or fails with a message
naming phases the author never referenced. The fix must make the refusal name **which plan's
namespace** was consulted, so a future mismatch is diagnosable without reading source.

**Opt-in.** None — validation runs unconditionally at create. Note the consequence: there is
no flag to stage this rollout behind, which is exactly why Required item 3 (retroactive policy
in the same slice) is not optional.
