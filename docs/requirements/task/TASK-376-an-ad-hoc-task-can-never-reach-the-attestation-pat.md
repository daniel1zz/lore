---
id: TASK-376
type: task
role: plan
title: "An ad-hoc task can never reach the attestation path that already ships for it — ac-scope requiredness is keyed on the parent plan's spec, which --adhoc guarantees is absent"
status: archived
priority: high
created: 2026-08-02
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Defect

An ad-hoc task can never satisfy `lore done`'s attested-pass floor by the normal path, so
`--override-attestation` becomes its routine archival route — while the machinery that would
produce a genuine attestation for it already ships, unreached.

Measured 2026-08-02 on `main`:

| fact | measurement |
|---|---|
| `VerifyRunnerService.verifyAdhocTask` exists and is CLI-reachable | `verify.ts:459`; `<PLAN>` positional declared `required: false` at `verify.ts:319-323` |
| the `ac_ref` port for ad-hoc evidence exists and is WIRED | `CorpusService.resolveDeclaredAcIdsForAdhocTask`, injected at `app.ts:637` and `app.ts:968` |
| both unlock only via `extra.ac_scope` | `verify.ts:112-114` — searches for the ONE spec whose criteria fully declare the task's `ac_scope` ids |
| ad-hoc tasks declaring `ac_scope` | **1 of the 25 most recent** — the other 24 are `null` |
| `--override-attestation` actually used | 19 mentions in the last 400 audit rows, reason string beginning `"Ad-hoc task (extra…"` |

# Mechanism root — the unlocking flag is required by a predicate `--adhoc` guarantees is false

`lore create --help`, `--ac-scope`:

> Required (may be empty) when **the parent plan's spec** declares >= 1 script-mode AC

`--adhoc` is defined as *"parented to the corpus root PRD **instead of a plan**"* and is
mutually exclusive with `--plan-id`. No parent plan ⇒ no parent plan's spec ⇒ the
requiredness predicate never evaluates true. The single flag that unlocks the ad-hoc
attestation path is gated on the single condition `--adhoc` guarantees is absent.

This is the THIRD instance of one pattern, not an isolated bug — see
`knowledge-the-adhoc-flag-severs-plan-membership-and-every`:

| # | mechanism | keyed on | effect on an ad-hoc task |
|---|---|---|---|
| 1 | `plan-close` gate | plan membership | never fires (handoff-71 KD3, observed 3x) |
| 2 | `--ac-scope` requiredness | parent plan's spec | never fires — THIS task |
| 3 | `active_sessions` derivation | `activePlanIds.has(parent_id)` | never fires (`task-active-sessions-derives-only-over-active-plans-`) |

# Required fix

1. Re-key `--ac-scope` requiredness so the ad-hoc branch is covered: creating a task with
   `--adhoc` requires an explicit `--ac-scope` value, which MAY be the explicit-empty form
   the plan branch already defines (`--ac-scope ""` → stores `[]`, distinct from omitted).
   An explicitly-empty declaration is an auditable statement that this task claims no
   criterion; a silently-absent one is indistinguishable from an author who never learned
   the flag applied to them.
2. Delete the stale gap paragraph at `packages/lore/src/adapters/cli/commands/verify.ts:118-126`.
   It documents the `ac_ref` limitation as OPEN; the port that closed it is wired at
   `app.ts:637`/`app.ts:968`. A reader budgeting work off that header re-derives the wrong
   conclusion — which is exactly what produced handoff-71's NS1.

⛔ Do NOT exempt ad-hoc tasks from the attested-pass floor. Ad-hoc is currently the dominant
task shape in this corpus; exempting it removes all three mechanisms above at once from the
majority of the work.

⛔ Do NOT auto-derive `ac_scope` for ad-hoc tasks. Guessing which spec governs a task is the
thing `verifyAdhocTask` deliberately refuses to do (`verify.ts:114`: "zero or multiple
matches refuse loud, never guessed"); auto-deriving at create time would reintroduce the
guess one layer earlier.

# Proxy / Silence / Opt-in

**Proxy.** `extra.ac_scope` is present" is a proxy for "this task's completion is
oracle-checkable". Concrete input satisfying the proxy while violating the property: a task
declaring `--ac-scope ""` — explicitly claiming no criterion. ACCEPTED and deliberate: the
empty declaration does not make the task verifiable, it makes the author's claim *auditable*,
which is a strictly different and achievable goal. The attested-pass floor still refuses
such a task at `lore done`, and `--override-attestation` remains the correct route for it —
the difference is that the override then records a decision someone made, not a mechanism
nobody could reach.

**Silence.** Present behaviour is the textbook case: the requiredness check no-ops, and
"requirement not applicable" is indistinguishable from "requirement satisfied". After the
fix the ad-hoc branch either has an explicit declaration or the create REFUSES.

**Opt-in.** Present behaviour makes `--ac-scope` opt-in for exactly the ad-hoc population —
constraining only the authors who already knew to use it. The fix makes it binding on the
whole branch.

# Oracle

- `lore create task --adhoc` WITHOUT `--ac-scope` exits 4 and the corpus doc count is
  unchanged; the SAME call with `--ac-scope ""` exits 0 and stores `[]`. Both in one test.
- CONTROL: the non-ad-hoc branch's existing requiredness behaviour is byte-identical —
  a plan-parented task whose spec declares 0 script-mode ACs still creates without the flag.
- An ad-hoc task declaring `--ac-scope <real-id>` can be run end-to-end by
  `lore verify --task <slug>` and lands evidence carrying BOTH `attestation` and `ac_ref` —
  asserting `attestation` alone would pass against the pre-existing behaviour.
- `grep -n "ac_ref" packages/lore/src/adapters/cli/commands/verify.ts` no longer returns the
  "structurally impossible" paragraph.


# Fourth instance, measured 2026-08-03 — the red-first floor is keyed on `ac_scope` too

`lore done --declare-no-new-tests` exists for "a task declaring `extra.ac_scope` with no red
(expected-fail/fail) evidence row and no `extra.red_first` opt-in". Because `--adhoc` leaves
`ac_scope` absent, **that floor's precondition is never met either** — an ad-hoc task archives
with no red evidence row and no `red_first` declaration, and nothing asks.

Measured on two tasks closed 2026-08-03
(`task-two-independent-copies-of-does-this-task-have-a-claim-now`,
`task-mcp-lore-evidence-add-cannot-set-capture-source-and-has-no`): each carries exactly two
`pass/runner` rows, zero red rows, `red_first: false`. Both implementers DID work red-first
(they reported 2 failed / 15 passed and 12 failed / 4 passed respectively), so the discipline
held — but the corpus cannot show it, and no mechanism noticed the absence. Compare the two
tasks in the same batch that DID land a red row: both had `red_first: true` set explicitly,
i.e. the floor is satisfied only by an author who already intended to satisfy it.

Extends the table above by a fourth row:

| 4 | `lore done` red-first floor (`--declare-no-new-tests`) | `extra.ac_scope` presence | never fires → archives with no red row and no opt-in, silently |

⛔ This does NOT change this task's fix, and must not be filed as a separate defect: re-keying
`--ac-scope` requiredness onto the ad-hoc branch arms this floor too, for free. Recorded here
so the fix's value is not under-counted.
