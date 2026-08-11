---
id: TASK-373
type: task
role: plan
title: "Plan-member sites twelve and thirteen, both structurally invisible to the new guard: my_claims[].plan_slug and lore list --plan-id"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: ADR-029, type: relates-to}
---
# Defect — plan-member sites TWELVE and THIRTEEN, both structurally invisible to the new guard

`bun run check:plan-member-sites` reached exit 0 when site 11 landed (`616e1b1`). Two more sites
exist and the guard cannot see either, because **R1/R2/R3 all key on COMPARISON shapes** and
these are a Map lookup and a store-filter key.

## Site 12 — `my_claims[].plan_slug` answers with the filing parent

`packages/lore/src/service/session-service.ts:306`, verified in source by the orchestrator on
`main`:

```
plan_slug: task.parent_id !== null ? (slugById.get(task.parent_id) ?? "(unknown)") : "(unknown)",
```

A field literally named `plan_slug`, inside `bootstrap`'s `my_claims` construction, resolved
from the `parent_id` proxy. Measured by `agent:fix-eleventh-plan-member-site` in its own
fixture corpus: a diverged task whose plan is Alpha reported `plan_slug: "plan-bravo"`, and an
ad-hoc task reported `plan_slug: "prd-root-prd"`.

Note lines 365 and 383 in the same file resolve `plan_slug` from a `planId` variable and are
NOT part of this defect — only the `my_claims` site keys on `parent_id`.

## Site 13 — `lore list --plan-id` is a parent_id filter wearing a membership name

`packages/lore/src/adapters/cli/commands/list.ts:202-210`, verified in source by the
orchestrator:

```
// Resolve --plan-id slug or ULID → parent_id ULID filter.
if (args["plan-id"] !== undefined) {
  const resolveResult = await app.corpusService.resolve(args["plan-id"]);
  …
  filters["parent_id"] = resolveResult.value;
```

The flag is named `--plan-id` and its own help text says "Filter by parent plan ID or slug
(resolves to parent_id)". A task whose `parent_id` legitimately diverges from its
`extra.plan_id` — the SUPPORTED `--plan-id P --parent Q` shape, SPEC-065 D4 — is therefore
ABSENT from `lore list --plan-id <its own plan>`. The module header at line 5 documents the
proxy behaviour as if it were the intent.

⛔ Deciding this one needs a judgment the other twelve did not: `--plan-id`'s help text
currently PROMISES a parent filter. Either the flag's contract changes to membership (and the
help text plus module header change with it), or the flag is renamed and a membership filter
added beside it. Do not silently switch the semantics of a documented flag — state which of the
two you chose and why, in the JSDoc.

## Stale references this wave created — both outside the fixing agents' anchors

1. `packages/lore/src/service/phase-migration-service.ts` (`buildGroups` JSDoc, ~lines 520-537)
   still says the tenth site "is reported as a follow-up rather than smuggled in here". It was
   closed by `task-the-tenth-plan-member-site-is-a-write-path-create-time` (`4f8e1b0`).
2. `scripts/check-plan-membership-sites.ts`'s R3 note says the `.has()` widening "would blind
   this rule to the one REAL violation in the very same file (`bootstrap`'s
   `d.parent_id === plan.id`)" — present tense, and that violation is now fixed. The ARGUMENT
   survives as the reason the widening stays rejected; only the tense and the example need a
   refresh. ⛔ Do not delete the paragraph — an absent explanation invites the widening to be
   re-proposed, which is exactly how `plan-membership.ts`'s false blocker survived three copies.

# Mechanism root — the guard closes the shapes it can SEE, not the family

This is the correction the family's history now forces, and it must not be lost:

| how the site was found | count |
|---|---|
| by hand, one at a time | 1-9 |
| by the grep oracle on its first run | 11 |
| by a fixing agent reading adjacent code, invisible to the oracle | 10, 12 |
| by the orchestrator checking a reported suspicion, invisible to the oracle | 13 |

`bun run check:plan-member-sites` exiting 0 means "no COMPARISON-shaped site outside the
allowlists". It does not mean the family is closed, and a future reader seeing exit 0 will
believe it does. Three shapes are structurally out of reach and were each measured and
deliberately not mechanized:

- **Map/Set lookup** (`slugById.get(task.parent_id)`, `activePlanIds.has(d.parent_id)`) — the
  `.has()` widening was measured during the guard's construction: it flags legitimate
  `knowledge`/handoff docs whose plan link genuinely IS `parent_id`, and allowlisting is
  by-file, so admitting them would have blinded R3 to the real violation in the same file.
- **Store filter key** (`filters["parent_id"] = <a resolved plan id>`) — site 13's shape.
- **Store lookup by parent** (`store.find(task.parent_id)`) — site 10's shape; widening was
  measured at ~4% precision (11 hits, 10 legitimate), needing a ~25-entry allowlist.

# Required fix

1. Site 12: resolve `my_claims[].plan_slug` from the task's `extra.plan_id` via the shared
   `isPlanMember`/membership key, never `parent_id`. An ad-hoc task has no plan by design — it
   must report `null`/`(unknown)` rather than the root PRD's slug.
2. Site 13: decide and document the `--plan-id` contract per the ⛔ note above, then implement it.
3. Refresh both stale references named above (tense + example only for the guard's R3 note).
4. ⛔ Amend `scripts/check-plan-membership-sites.ts`'s module header to state plainly that
   **exit 0 means "no comparison-shaped site", not "the family is closed"**, and to name the
   three out-of-reach shapes with the measurement that rejected each. A guard whose scope is
   only in a task doc is a guard whose next reader over-trusts it.
5. ⛔ Do NOT widen R1/R2/R3 to reach these shapes. Every widening was measured and rejected on
   precision grounds; re-litigating it needs new measurements, not a new opinion.

# Oracle

- RED first per site, in a throwaway corpus (`mkdtemp` + `lore init`, ⛔ NEVER this repo's
  `.lore/`): a task with `extra.plan_id = P`, `parent_id = Q` (P ≠ Q).
  - Site 12: `lore bootstrap --json`'s `my_claims[]` entry for a claim on that task reports
    P's slug. Assert the VALUE, and assert the ad-hoc case reports no plan rather than the root
    PRD's slug — two independent assertions, since one fix could satisfy either alone.
  - Site 13: `lore list --plan-id P` INCLUDES that task (or, if the contract stays `parent_id`,
    the new membership filter does and the help text no longer promises otherwise).
- CONTROL: a task with `parent_id === extra.plan_id` is unaffected in both surfaces.
- CONTROL: `bun run check:plan-member-sites` still exits 0 (measure without a pipe) — these
  fixes must not introduce a comparison-shaped violation.
- CONTROL: the guard's own suite (`scripts/tests/check-plan-membership-sites.test.ts`) passes
  with `KNOWN_OPEN_SITES` still EMPTY — ⛔ these two sites are invisible to the guard and must
  NOT be added to that ledger; the ledger tracks what the guard reports, not what exists.
- Measure every exit code WITHOUT a pipe (`cmd > out 2>&1; echo $?`).

Distribution surface: binary-side (`packages/lore/**`) — `lore bootstrap` feeds the
session-start injection and `lore list` is a primary read verb, so both ship to the two named
consumers (`babyai`, `guyin`) with the next build.
