---
id: KN-483
type: knowledge
role: knowledge
title: "The falsifier mechanism is shipped but inert: a coverage field blind to 692 criteria, and 8 declarations with no live execution path"
status: approved
priority: medium
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PRD-001
links:
  - {id: SPEC-129, type: relates-to}
  - {id: PLAN-123, type: relates-to}
---
Measured 2026-08-21 against this repo's own corpus, `dist/lore` built from `dde8826`
(HEAD). Every figure below names the command that produced it, so each is
re-runnable rather than a standing claim.

## F1 — `pass_unfalsified_count` cannot measure the discriminating-power gap, and the shortfall is 692

`lore status --json` reports `data.pass_unfalsified_count = 29`. That field is
NOT the count of criteria never observed red. `deriveAcCoverageState`
(`packages/core/src/acceptance.ts:676`) short-circuits one row earlier:

    if (fact.attested_pass > 0) return "attested_pass";
    if (fact.pass > 0) { ... return fact.falsified === 0 ? "pass_unfalsified" : "pass"; }

So every criterion holding a runner-attested pass resolves to `attested_pass`
and can never surface as `pass_unfalsified`, no matter how many times it was
never falsified. Measured split over the corpus:

| quantity | value |
|---|---|
| distinct script-mode AC ids | 769 |
| ...declaring a `verify.falsifier` | 8 |
| ...holding attested evidence | 700 |
| ...attested BUT declaring no falsifier (invisible to the field) | **692** |

⛔ This is NOT a defect in `deriveAcCoverageState` — `AC-FALS-3` on
`spec-oracle-tier-falsifiability-a-criterion-never-observed-red` states the
precedence verbatim: "deriveAcCoverageState still returns attested_pass ... so
pass_unfalsified never outranks an attested pass". The behaviour is specified
and correct. The defect is that `AC-FALS-6` ("lore status --json reports an
integer count of corpus-wide pass_unfalsified criteria, and that count rises by
exactly 1 when one more never-red criterion is declared") PASSES while the goal
it was written for — make the discriminating-power gap visible — is unmet for
90% of the corpus. A textbook instance of the standing rule that an AC proves
only the point it explicitly asserts, and that the gap between "goal met" and
"AC green" is the AC author's responsibility.

⇒ Any gate built on `pass_unfalsified_count` inherits the 692-criterion blind
spot. A correct measure must be a NEW orthogonal field (discriminating power and
evidence strength are independent dimensions); widening the 7-state enum would
contradict `AC-FALS-3`.

Reproduce: `lore status --json | python3 -c "import sys,json;
print(json.load(sys.stdin)['data']['pass_unfalsified_count'])"` for the field;
the split is a `json_each` join over `docs.extra.acceptance_criteria` against
`docs.extra.verification_evidence` where `type='task'`.

## F2 — a falsifier is declared on a long-lived spec but executable only through a short-lived plan

`lore verify --falsify` requires the PLAN positional and explicitly refuses the
ad-hoc `--task` channel (its own `--help` text: "Requires the PLAN positional
(not the ad-hoc --task path)"). `resolveTargetTask`
(`packages/core/src/task-workflow.ts:995`) then needs either a fresh claim in
that plan or an explicit `--task`.

All 8 criteria that declare a falsifier have an ARCHIVED governing plan:

    AC-TC-5, AC-TC-2, AC-BFI-10, AC-MIS-2, AC-MIS-6, AC-OX-1, AC-OX-7, AC-OWN-4

So none of them can be re-verified today. The declaration outlives its own
execution path. This is the mechanism reason — not agent negligence — behind F3.

⇒ Arming a gate that merely REQUIRES a declared falsifier produces dead
declarations: green at spec-promote time, unrunnable one plan-archive later. A
plan-independent batch execution path (shape: a repo ratchet script invoked from
`hooks/pre-push`, as `scripts/check-anchor-coverage.ts` already is) is a
PREREQUISITE for the gate, not a follow-up to it.

Reproduce: for each spec holding a `verify.falsifier`, join `docs` on
`parent_id` for `type='plan'` and read `status`.

## F3 — 279 `expected-fail` evidence rows, 2 of them attested

| quantity | value |
|---|---|
| `result: "expected-fail"` evidence rows | 279 |
| ...carrying an `attestation` block | **2** (AC-MIS-2, AC-TC-2) |
| ...self-reported | 277 |
| distinct AC ids with any expected-fail row | 126 |

The red-first discipline is being FOLLOWED (126 criteria have a recorded red)
but almost entirely by self-report. Combined with F2, the 2 attested reds are
exactly the two whose falsifier ran while their plan was still live.

⇒ "red-first evidence exists" and "the oracle was machine-proven to
discriminate" are different claims, currently differing by 138x in this corpus.

Reproduce: filter `docs.extra.verification_evidence` on
`result = 'expected-fail'` and partition on `attestation IS NOT NULL`.

## Constraint carried forward

The funnel, end to end, measured today:

    853 declared AC -> 829 script-mode -> 769 distinct ids
      -> 700 attested pass (89%)
      -> 8 declaring a falsifier (1%)
      -> 2 machine-proven to discriminate (0.26%)

An 89% attested-coverage figure and a 0.26% proven-discrimination figure describe
the same corpus. Reporting the first without the second overstates verification
by two orders of magnitude.

## Relation to existing corpus — same root, different consequence

`plan-land-judgment-verification-path-checked-assess-findings-a` already recorded
the SAME structural fact from the exemption-design angle: "the corpus does not
record when an acceptance criterion was authored (`lore ac add` does not demote,
so a criterion can be appended today to a spec whose plan archived last month),
so no arming-window predicate over criteria is decidable."

F2 above is that same decoupling — AC lifetime is independent of plan lifetime —
observed on the EXECUTION side instead of the predicate side: a falsifier
declared on a live spec becomes unrunnable the moment its plan archives. Two
consequences, one root. Neither supersedes the other.

`task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error` recorded the
attested-but-not-actually-true shape once already ("It passed every AC, was
attested, and was archived, because nothing asserted that a message's own
instructions are executable"). F1 is the same shape at corpus scale rather than
at one message: `AC-FALS-6` is green and the goal it serves is unmet for 692 of
769 criteria.

---

## CORRECTION 2026-08-21 — two claims above are withdrawn

Recorded by the same actor, same day, after `knowledge-handoff-agent-main-orchestrator-111`
measured the runner directly. Both corrections make this document's conclusions
WEAKER, not stronger.

### C1 — F2's inference was wrong; its measurement stands

The measurement holds: all 8 criteria declaring a falsifier have an archived
governing plan. The INFERENCE drawn from it — that a plan-independent batch
execution path is a PREREQUISITE — does not. Handoff 111 KD7 names the
overstatement explicitly ("'archiving makes falsifiers permanently unprovable'
was overstated") and NS5 gives the correct reading: **archiving ends the CURRENT
window only; a future plan carrying those `ac_scope`s can run them.** A new plan
declaring the ac_scope is sufficient, so no new execution channel is needed.

⇒ Strike "a plan-independent batch execution path is a PREREQUISITE for the
gate" from F2. What remains true is narrower: no falsifier can be re-run
*without* a live plan declaring its ac_scope, which is an availability
constraint on scheduling, not an architectural gap.

### C2 — F3's "2 machine-proven" figure is withdrawn; the true count is UNKNOWN and probably 0

Handoff 111 KD2/KD3 measured the runner itself: **11 of 11 `--falsify`
invocations recorded `expected-fail` + `capture_source: runner` while never
executing their mutation** — 10 criteria, 3 specs, a 100% false-match rate.
Three causes, all exiting 1: absent usable `node_modules`; untracked files
absent because the scratch worktree comes from `git stash create` WITHOUT
`--include-untracked`; and `dist/lore` being gitignored. KD3 is the load-bearing
part: **no choice of exit code can separate a startup failure from an assertion
failure**, because vitest and bun test both exit 1 for each and `1` is the
natural declared value for "this mutation should make the test fail". The
distinguishing signal exists only in the OUTPUT, which the runner never reads.

F3 above counted AC-MIS-2 and AC-TC-2 as "machine-proven to discriminate"
because their rows carry an attestation. That inference used exactly the
comparison KD2 proved vacuous. Those two rows predate the 11, but nothing about
their age exempts them from the same defect — they were produced by the same
exit-code-only comparison, so their attestation certifies nothing about
discriminating power either.

⇒ The funnel's last line should read `2 rows whose attestation is not evidence`
rather than `2 machine-proven to discriminate`. The honest count of criteria
proven to discriminate is **unknown, with 0 as the defensible floor**, until the
green control lands and a falsifier is re-run under it.

### What actually unblocks this

`plan-close-the-falsify-green-control-gap-an-unrunnable-scratch` /
`task-run-the-unmutated-green-control-before-the-mutation-and`, governed by
**AC-FR-11** on `spec-falsifiability-reachability-a-feedable-checkpoint-an`: run
the UNMUTATED command in the same scratch worktree first, and record
`inconclusive` when it fails. One step, catches all three causes, reads no
output, needs no new syntax.

⛔ Ordering consequence for anything built on top: a gate keyed on falsifier
DECLARATIONS is meaningless until the RUNNER is trustworthy. Green control comes
first — not the coverage field of F1, and not the ratchet.
