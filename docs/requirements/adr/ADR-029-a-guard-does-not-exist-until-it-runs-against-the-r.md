---
id: ADR-029
type: adr
role: decision
title: "A guard does not exist until it runs against the real tree, and a new guard needs a family with >=7 remaining instances"
status: draft
priority: medium
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Context — measured, not impressionistic

The user asked why sessions never converge: things to change keep growing. Three hypotheses
were tested against the full corpus and git history on 2026-08-03 (`main @ 23bb6bf`, clean
tree, full suite green — `TEST_EXIT=0` / `TYPECHECK_EXIT=0`, vitest 451 files / 7948 passed,
bun 1767 pass / 0 fail, both exit codes measured WITHOUT a pipe). All three were WRONG:

| hypothesis | measurement | verdict |
|---|---|---|
| the backlog is growing | open tasks held at 20–35 for 16 days; 562 of 596 archived | ✗ |
| deferred items roll forward forever | open-task age: median **2 days**, max **7** | ✗ |
| the same defects keep recurring | only **4 of 34** open tasks self-identify as the Nth instance of a known family | ✗ (12%) |

## What is actually happening

**101 of 596 tasks (17%) are defects in the verification/guard machinery itself** — deduped,
matched on multiple independent lone-token conditions (never one remembered phrase). Of the 34
currently open, **16 (47%)** are. The share of each day's new findings that is machinery-about-
machinery climbed monotonically:

    2026-07-23   0/19        2026-07-31  10/36
    2026-07-26   5/56        2026-08-01  30/63
    2026-07-27  18/49        2026-08-02   2/13
    2026-07-28  10/42        2026-08-03   8/10   ← 80%

The largest families are all about the quality machinery: test-selection blind spots (27),
no-match-reads-as-pass (22), SSOT↔installed-asset divergence (20), false oracles (18),
CLAUDE.md budget (16). The work became mostly an inspection of the inspectors. That is the
non-convergence mechanism — not indiscipline, and not recurrence.

## The finding that reframed it

A guard was assumed to close a family permanently: the ordinal-write-site family produced 0
new instances after `scripts/check-ordinal-write-sites.mjs` landed (`4868c29`, 2026-07-27).
**That causal attribution is retracted.** That script has zero tests and zero invokers — it is
inert. The family's stop is better explained by the SPEC-084 ordinal work simply ending.

Auditing all five static checkers: there is **no CI** (`.github/` does not exist) and
`hooks/pre-push` runs four `lore` checks and zero `check-*` scripts, so the ONLY arming path is
a test that calls the checker's `main()` with no injected root.

| checker | test | real-tree run | armed |
|---|---|---|---|
| `check-no-nul-bytes.ts` | yes | `describe("… real repo tree (task oracle)")`, `expect(main()).toBe(0)` | **YES** |
| `check-test-budgets.ts` | yes | `describe("… main() — real repo tree …")` | **YES** |
| `check-no-timer-retry.ts` | yes | pure functions only, never calls `main()` | no |
| `check-ac-ref-integrity.ts` | yes | `mkdtemp` + `lore init` throwaway only | no |
| `check-ordinal-write-sites.mjs` | **none** | — | no |

Three of five guards were paid for and never wired. All five are registered identically in
`package.json`; `bun run test` is green either way. **A guard that is never executed is
indistinguishable from a guard that passes** — the false-oracle vector this corpus already
catalogues, applied to the guard layer itself.

# Decision

## D1 — A guard does not exist until it is executed against the real tree

The delivery surface for a `scripts/check-*` invariant is `export function main(repoRoot =
REPO_ROOT): number` (RETURNS, never exits) + `if (import.meta.main) process.exit(main())` + a
test calling `main()` with NO injected root, asserting the exit VALUE. Registering a
`package.json` script is not arming. A checker whose only proof is a fixture run is inert, and
counting it as built is how three of five came to be inert without anyone noticing.

A green arming assertion is itself insufficient: the suite must also DEMONSTRATE the failure —
introduce a real violation, see RED, remove it, see green. A `main()` returning 0
unconditionally passes a green-only assertion.

## D2 — Build a new guard only for a family with >= 7 known remaining instances

101 machinery-defect tasks against 10 mechanisms that actually run (8 registered gate
checkpoints + the 2 armed checkers) is **~10 defect findings per live mechanism**. A new guard
therefore does not pay for itself unless the family it closes has at least ~7 known remaining
instances. Below that line the correct output is a WRITTEN exemption, not a mechanism.

This is a planning heuristic derived from THIS corpus's own ratio — not a universal law. It is
stated as a number so it can be argued with and re-measured, which prose cannot.

Applying it on 2026-08-03:

| family | known | still open | build a guard? |
|---|---|---|---|
| plan-membership keying | **10 sites** | 1 | ✅ the only one above the line |
| false oracle | 18 | 6 | ✗ |
| duplicated logic / N copies | 6 | 1 | ✗ |
| `--adhoc` severs a plan-keyed mechanism | 4 | 2 | ✗ |
| session / actor identity collapse | 3 | 1 | ✗ |
| no-match reads as pass | 22 | 2 | ✗ family already near closed |

## D3 — Arming an existing inert guard is always in scope, and outranks building a new one

Wiring a paid-for guard adds ZERO new machinery surface and is not subject to D2's threshold.
When both are available, arm before building.

## D4 — The exemption is scoped to MECHANIZATION, never to the defect

⛔ A sub-threshold family getting no guard does NOT archive, waive, or downgrade the defects
inside it. Each defect keeps its own disposition — fix, defer with a reason, or exempt in
writing — decided individually. In particular a defect on a SHIPPED channel is fixed on its
merits regardless of its family's size: `task-phaseworkflowservice-claim-captures-no-session-
id-so-every` is a critical live regression (`noAnchorOverlap` reads a field only one of its two
claim writers sets, so a same-actor phase overlap lands in an unsatisfiable fail-safe refusal),
and it is NOT a candidate for exemption merely because its family has three members.

Conflating "this family gets no guard" with "these defects go away" would convert a cost
control into silent data loss. The two decisions are independent.

## D5 — Convergence is bounded by a termination criterion, and lore has none

The predicate currently governing the work is "no mechanism gap findable by inspection", which
is unbounded by construction: every mechanism built becomes new inspectable surface, which is
exactly what the 17%/47% figures measure. D1–D4 slow the growth; they cannot terminate it.
Terminating requires an EXTERNAL criterion — a named consumer, a release, a shipped
integration — against which a finding is either in scope or out of scope. Choosing that
criterion is a product decision and remains OPEN. Recording it here so the next session does
not re-derive D1–D4 and mistake them for convergence.

# Consequences

- Two tasks were filed under this ADR and dispatched the same session:
  `task-three-of-five-static-checkers-are-inert-no-exported-main` (D3) and
  `task-plan-membership-has-ten-known-sites-and-no-enumeration` (D2's single qualifier).
- Both carry an explicit ⛔ boundary: a newly-armed checker that goes RED against the real tree
  must NOT be silenced by weakening a rule, narrowing a scan, or adding an allowlist entry.
  Pre-existing debt surfaced by arming is a reportable finding, adjudicated by a human.
- An earlier decision in the same session — extending `lore scope` with an explicit-empty
  declaration surface so the ad-hoc back-catalogue could satisfy a new create-time rule — was
  REVERTED under D2: it would have added machinery surface for a 4-instance family. The
  anchors added for it were removed (`lore anchor rm`, v4). The corpus's own preference for a
  written exemption over synthesizing the artifact a predicate looks for already pointed the
  same way.
- D2's ratio must be re-measured, not inherited. Any session invoking the threshold recomputes
  it: machinery-defect task count over mechanisms that actually run.


# Correction to D2, measured the SAME day (2026-08-03) — a guard closes SHAPES, not families

D2 above says a family with >= 7 known remaining instances justifies a guard, with the implied
payoff that the guard then closes the family. Wave 1 measured that implication and it is FALSE
for the one family that qualified.

`bun run check:plan-member-sites` shipped, reached exit 0, and the plan-member family
immediately produced two more sites that the guard **structurally cannot see**:

| how each site was found | sites |
|---|---|
| by hand, one at a time | 1-9 |
| by the grep oracle on its first run | 11 |
| by a fixing agent reading adjacent code — invisible to the oracle | 10, 12 |
| by the orchestrator checking a reported suspicion — invisible to the oracle | 13 |

R1/R2/R3 all key on COMPARISON shapes. Three other shapes carry the same defect and each was
measured and deliberately NOT mechanized:

- **Map/Set lookup** — `slugById.get(task.parent_id)` (site 12), `activePlanIds.has(d.parent_id)`.
  The `.has()` widening flags legitimate `knowledge`/handoff docs whose plan link genuinely IS
  `parent_id`; allowlisting is by-file, so admitting them would have blinded R3 to a real
  violation in the same file.
- **Store filter key** — `filters["parent_id"] = <resolved plan id>` (site 13).
- **Store lookup by parent** — `store.find(task.parent_id)` (site 10); widening measured at ~4%
  precision (11 hits, 10 legitimate), needing a ~25-entry allowlist.

## Consequence for D2

D2's threshold stands as a COST rule — do not build a guard for a small family. Its implied
BENEFIT claim does not: **"guard exits 0" means "no instance of the shape the guard matches",
never "the family is closed."** A grep oracle is a proxy, and this corpus's own ADR
(`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`) requires the proxy's gap to
be stated where the mechanism is read — not only in the task doc that built it.

Two obligations follow, both filed as
`task-plan-member-sites-twelve-and-thirteen-both-structurally`:

1. A guard's module header must state what its exit 0 does NOT cover, with the measurement that
   rejected each un-mechanized shape. A guard whose scope lives only in a task doc is a guard
   whose next reader over-trusts it.
2. ⛔ A family's remaining-instance count is NOT a countdown once a guard exists. Re-derive it by
   reading the code, not by trusting the guard's exit code.

## Consequence for D1

D1 is unaffected and was confirmed in the same wave: all three inert checkers went green on their
first-ever real-tree run, so arming them surfaced no debt — but the arming was still the
prerequisite that made "guard exists" mean anything. Note the ordinal guard's causal claim
retracted in the Context section above remains retracted: it had 0 tests and 0 invokers.

# Second correction — full-suite verdicts on this machine are conditional

Every "TEST_EXIT=0" recorded in this ADR's context and in the session's handoffs was measured
with `CLAUDE_CODE_SESSION_ID` SET in the ambient environment.
`packages/lore/tests/integration/gate-p2-cross-tier.bun.test.ts` has one case whose green
depends on that variable: with it, 22 pass / exit 0; with `env -u`, 21 pass / 1 fail / exit 1
(`Expected: 0 / Received: 4` — the correct `ANCHOR_OVERLAP_SESSION_UNMEASURED` fail-safe).

The production behaviour is correct in both cases; the ORACLE asserts a value that holds only
under an undeclared precondition. Filed as
`task-a-test-s-green-depends-on-an-ambient-claude-code-session`. The repo has no CI
(`.github/` does not exist), which is why nothing caught it. ⛔ Until it is fixed, a full-suite
green from this repo must be reported WITH that condition named, not as an unconditional verdict.
