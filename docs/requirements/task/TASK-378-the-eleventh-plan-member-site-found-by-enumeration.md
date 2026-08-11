---
id: TASK-378
type: task
role: plan
title: "The eleventh plan-member site, found by enumeration: bootstrap's active-plan task listing and its active_sessions sibling both key on the parent_id proxy"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: ADR-029, type: relates-to}
  - {id: TASK-381, type: relates-to}
  - {id: TASK-377, type: relates-to}
---
# Defect — the ELEVENTH plan-member site, found by enumeration on the guard's first run

`bun run check:plan-member-sites` (landed `2baf2bc`) reported one violation on its very first
real-tree run. Reproduced independently on `main` after merge, exit code measured without a
pipe (`bun run check:plan-member-sites > out 2>&1; echo $?` → **3**):

```
packages/lore/src/service/session-service.ts:251: plan-scope-on-parent-id-proxy
  const tasks = allDocs.filter((d) => d.type === "task" && d.parent_id === plan.id);
```

Verified in source by the orchestrator, not taken on the agent's report: `session-service.ts`
lines 248-253 are `bootstrap`'s active-plan loop — for every non-archived, non-deprecated plan
it collects that plan's tasks by `parent_id`.

Plan membership IS `extra.plan_id` (the DECLARED property; `lore create task --plan-id P
--parent Q` with `P !== Q` is a SUPPORTED shape, SPEC-065 D4). So a task whose `parent_id`
legitimately diverges from its own plan is **silently dropped from that plan's `active_plans`
entry in `lore bootstrap`** — and `bootstrap` is the SESSION-START INJECTION path. Every
session's first view of the corpus can under-report a plan's tasks, and the resulting
readiness/progress numbers read as authoritative.

## Sibling in the same function, invisible to the guard

`session-service.ts:284`:

```
const activeTasks = allDocs.filter(
  (d) => d.type === "task" && d.parent_id !== null && activePlanIds.has(d.parent_id),
);
const activeSessions = deriveSessions(activeTasks, nowIso, this.deps.claimTtlMinutes);
```

Same defect, `.has()` shape instead of a comparison, so R3 structurally cannot see it (the
guard's residual is documented in its own JSDoc, with the measurement showing why the `.has()`
pattern cannot be admitted: it would force a whole-file allowlist on `session-service.ts` and
blind R3 to line 251 in the same file). Consequence: a diverged task's live claim is missing
from `bootstrap`'s `active_sessions`, which is the field a fresh session reads to learn who
else is working BEFORE it claims.

# Why the eight-site sweep missed it — a mislabeled enumeration row

`task-eight-more-plan-member-queries-still-key-on-parent-id`'s table listed
`session-service.ts:766` as *"bootstrap active-plan task listing"*. Line 766 is
`computeReadinessPointer` — the `resume` path, which IS membership-keyed today. `bootstrap`'s
own listing was never converted, and the sweep's table recorded the fix as covering it.

That is the mechanism-level lesson: **a hand-authored enumeration table is itself unverified
data.** Nine sites were closed against a list nobody could check; the tenth and eleventh were
found by a write-path review and by a grep oracle respectively. The guard exists so site 12 is
found by construction rather than by the next reader's attention.

# Required fix

1. `session-service.ts:251` — resolve the plan's tasks by membership: `isPlanMember(d, plan.id)`
   from `./plan-membership.js` (already imported in this file at line 61). Do NOT re-implement
   the comparison inline; the guard's R1/R2 will flag it if you do.
2. `session-service.ts:284` — same conversion for the `activeTasks` derivation. Membership must
   decide which plan a task belongs to; `activePlanIds` still decides which plans are active.
   Keep those two concerns separate — the active-plan filter is NOT the defect.
3. Retire the `KNOWN_OPEN_SITES` ledger row in
   `scripts/tests/check-plan-membership-sites.test.ts`. The suite asserts EXACT set equality,
   so fixing line 251 without emptying the ledger fails the suite by construction — that is
   deliberate, and it is how the ledger retires with the defect instead of outliving it.
   With an empty ledger the arming assertion becomes plain `expect(main()).toBe(0)`.
4. `plan-membership.ts`'s module JSDoc is now STALE: it states the companion grep for the raw
   comparison exists only as a sentence in a comment. It must name `bun run
   check:plan-member-sites` as the shipped mechanism, and must not re-derive the retired
   "companion check is only prose" framing.

⛔ Do NOT widen the guard's R3 to a `.has()` pattern to make site 284 machine-visible. That
widening was measured and rejected during the guard's construction (it flags legitimate
`knowledge`/handoff docs whose plan link genuinely IS `parent_id`, and allowlisting is by file,
which would blind R3 to line 251). Fix the code; leave the documented residual documented.

# Proxy / Silence / Opt-in

**Proxy** — closes. `extra.plan_id` is not a proxy for membership; it IS membership
(`isPlanMember`'s own Q1 answer). No input satisfies `isPlanMember(t, p)` while `t` is not a
member of `p`.

**Silence** — this is the defect's whole character: a dropped member produces a SMALLER task
list, never an error. `bootstrap` prints a plausible number either way, which is why ten sites
survived. The fix does not add a signal; the guard is the signal, and it now runs.

**Opt-in** — none. `bootstrap` runs on every session start; nothing gates it.

# Oracle

- RED first: a fixture corpus (`mkdtemp` + `lore init`, NEVER this repo's `.lore/`) containing a
  plan `P`, a second doc `Q`, and a task with `extra.plan_id = P` but `parent_id = Q`. Assert
  `bootstrap`'s `active_plans` entry for `P` INCLUDES that task, and that the assertion fails
  before the fix. Assert the task's PRESENCE — asserting a count alone passes against an
  unrelated off-by-one.
- The same fixture with a fresh claim on the diverged task: `bootstrap`'s `active_sessions`
  must include it (covers line 284 independently of line 251 — one test per site, since a
  single test could pass on either fix alone).
- CONTROL: a task whose `parent_id === extra.plan_id` (the common shape) is unaffected —
  byte-identical `active_plans` output before and after.
- CONTROL: an ad-hoc task (`extra.adhoc === true`, parented to the root PRD) is NOT dragged
  into any plan's listing by either change.
- CONTROL: `bun run check:plan-member-sites` exits **0** after the fix (measure without a pipe).
- REGRESSION: `scripts/tests/check-plan-membership-sites.test.ts` passes with the emptied
  ledger, and `packages/lore/tests/unit/service/isplanmember-single-definition.test.ts` stays
  byte-unchanged and green.

Distribution surface: binary-side (`packages/lore/**`) — `lore bootstrap`'s output is consumed
by the session-start hook, so the fix ships to consumers with the next build.
