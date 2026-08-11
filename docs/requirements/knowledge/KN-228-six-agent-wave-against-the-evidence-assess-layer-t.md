---
id: KN-228
type: knowledge
role: knowledge
title: "Six-agent wave against the evidence/assess layer: the judge missed the real defect for the second consecutive session, three of six agents attested work they had not committed, and my own AC's premise was unsatisfiable"
status: approved
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: ADR-028, type: relates-to}
---
# Six-agent wave against the evidence/assess layer: the judge missed the real defect for the second consecutive session, and three of six agents attested work they had not committed

Session of 2026-08-01, resuming `knowledge-handoff-agent-main-orchestrator-59`. Two specs,
two plans, six implementer slices, all merged. What follows is only the findings whose ROOT
is a missing mechanism — symptom-level fixes are omitted deliberately.

## 1. Plan membership is `extra.plan_id`, but two plan-scoped reads key on `parent_id`

`knowledge-handoff-agent-main-orchestrator-55` KD6 ("the last-task advisory fired while a
sibling was still draft … NOT confirmed", confidence 50) is now CONFIRMED, and the cause is
neither a race nor a stale read — it is a field mismatch.

Measured in a throwaway corpus with four cases, the must-NOT-fire cases asserted BEFORE the
must-fire one, and the must-fire case doubling as the liveness sentinel:

| case | observed | expected |
|---|---|---|
| same-parent sibling still draft | advisory absent | absent ✓ |
| all same-parent siblings terminal | advisory FIRED | FIRED ✓ (proves the probe is not blind) |
| adhoc task, parent is the root PRD | advisory absent | absent ✓ |
| **plan member parented to ANOTHER plan** | **advisory FIRED with the sibling still `draft`** | absent ✗ |

`lore create task --plan-id P --parent Q` (both plans) is a SUPPORTED shape — `--parent`
merely DEFAULTS to `--plan-id`. `computePlanNowFullyTerminal` and `ready()` both query
`findMany({ parent_id: plan.id, type: "task" })`, so a diverged member is invisible to both.
`lore ready` does not merely omit it — it MISATTRIBUTES it, listing the task as `ready:true`
under the wrong plan and absent from its real one.

Blast radius beyond the advisory: the readiness count the whole worktree-dispatch discipline
depends on ("assert ready:false == merged tasks") is computed from the same query.

Filed: `task-plan-membership-is-extra-plan-id-but-the-last-task`.

## 2. `lore evidence` / `lore release` accept an attestation from an UNCOMMITTED worktree

One implementer recorded SEVEN evidence rows — four `pass` with an `ac_ref`, each with a real
non-empty tail — and released its claim, while its entire implementation sat as uncommitted
working-tree state and `git log main..<branch>` was EMPTY.

The corpus said verified-and-unclaimed. Git said the branch was empty. The routine post-merge
cleanup (`git worktree remove` + `git branch -d` after confirming merged) would have found
nothing to merge, removed the worktree, and destroyed the slice — while leaving four passing
rows in the permanent record attesting a tree that no longer existed anywhere. Recovered only
because the standing "verify `git log` before merge+cleanup" rule was followed by hand.

Grepped: there is NO git working-tree check anywhere on the evidence or release paths. The
claim already records `extra.claim.worktree`, so the predicate has its input.

This is the DOCUMENTED `subagent-stop-commit-guard.mjs` gap (a live background child at
hook-fire time) manifesting — do not "fix" the hook. What is NEW is the consequence: the gap
was catalogued as a risk of LOSING WORK; it also produces FALSE CORPUS STATE. Three of six
agents this session stopped with uncommitted work; the difference from the three that
committed was timing, not discipline, so it recurs at random.

Filed: `task-lore-evidence-and-lore-release-accept-an-attestation-from`.

## 3. An under-specified AC produced a mechanism that contradicts its own record

The absence-suppression slice shipped, and the FIRST assessment produced afterwards stored:

    dimension_scores      : scope_fidelity REMOVED          <- suppression worked
    unverifiable[]        : "scope_fidelity dimension score  … suppressed as ungrounded
                            rather than PUBLISHED AS A FINDING"
    typed_gaps            : scope_fidelity STILL PRESENT     <- published anyway
    gaps[0] (legacy)      : same text, published anyway

The record simultaneously claimed the finding was not published and published it twice. The
false-major it published was authored on absence and asserted the work could not be
inspected — the exact failure mode the governing spec was written to stop, still occurring
after the mechanism meant to stop it shipped.

ROOT CAUSE IS THE AC, NOT THE IMPLEMENTATION. The AC said "removed from the persisted
assessment's **dimension findings**"; `dimension_scores` and `typed_gaps` are separate
arrays. The implementer took the narrower reading and all four of its ACs passed, attested.

**Standing lesson**: when an AC names a *concept* ("dimension findings", "the record", "the
output") rather than the *field(s)*, a faithful implementation can satisfy every AC and leave
the motivating defect alive. An AC that specifies a removal must enumerate every field the
value is reachable from.

Fixed in-session by `task-t6-...` (typed_gaps + the legacy projection now filtered on the
same `ungrounded` list, joined on exact `typed_gaps[].dimension` equality — deliberately NOT
the case-insensitive substring rule used for free-text `unverifiable[]`, and documented as an
invariant so the two are not later "harmonised").

## 4. `lore assess` derives a plan's commits by grepping task slugs out of commit messages

`deriveCommitSetForPlan` selects via `git log --fixed-strings --grep=<task-slug>`. Every
implementation commit this session was conventionally worded and contained no slug, so
derivation returned zero for a plan whose work had landed minutes earlier.

The zero is not inert. It propagates: `diff_available=false` → the judge scores
`scope_fidelity` on absence → a `major` typed gap asserting the plan's placement constraints
"cannot be inspected" (true of the BUNDLE, published as a defect in the WORK).

The gap is the CONVENTION, not the algorithm. Nothing states, teaches, or enforces the
precondition — no gate, no hook, and nothing in the dispatch-bundle template. The derivation's
own header anticipates the squashed-history case, so its authors knew the precondition was
fragile; the producer-side half was never built. Any fix must also state what happens to the
back-catalogue, every archived task of which lacks the slug in its commits.

Filed: `task-lore-assess-derives-a-plan-s-commits-by-grepping-task`.

## 5. A test retitled to KEEP the AC id substring holds its AC's oracle green while the AC's statement goes stale

The suppression slice retitled three pre-existing `AC-067-4` sub-tests to
`REGRESSION (superseded AC-067-4): …` and rewrote them to assert the NEW behaviour. Because
`-t "AC-067-4"` is a substring filter, the AC's oracle kept matching and kept passing — while
`AC-067-4`'s STATEMENT ("emerges from finalization with confidence forced to low") had become
false, and the function it named no longer existed.

This is the false-oracle family with a new face: exit-code-true, statement-false, and the
oracle structurally cannot detect that its own statement drifted. Repaired with `lore ac set`.

**Mechanization candidate**: an AC whose statement has not changed while every test matching
its `-t` filter has changed title is a detectable, deterministic condition.

## 6. `lore ac set` demotes an approved spec; `lore ac add` does not

Measured in the same session: appending a criterion left the spec `approved`; editing one
demoted it to `draft`. The asymmetry is coherent (edit-a-contract-term vs extend), but the
demotion is exactly the silent-freeze trap the corpus-workflow injection warns about — every
downstream `task-claim` freezes until re-approval. Caught only because the status was checked
immediately afterwards.

## 7. The anchor-overlap gate is structurally blind to a task nobody claimed

A concurrent session's task declared `packages/lore/src/service/task-workflow-service.ts` —
byte-identical to this session's T1 anchor — and its implementer never ran `lore claim`.
`noAnchorOverlap` evaluates at claim time against OTHER FRESH CLAIMS, so an unclaimed task's
anchors are invisible and the gate cannot fire. CLAUDE.md records the weaker form of this
("all agents falling to the same OS username → the gate never fires"); skipping the claim
entirely bypasses it completely. No collision resulted only because the edited regions
happened not to overlap.

## 8. The judge missed the real defect for the second consecutive session

Of five findings on the first assessment: one `major` was FALSE against the code (it posited a
vacuous self-comparison where the test pins a hand-derived literal), one `minor` was partly
false (its inference was refuted by an in-test negative control), two were true-about-the-
bundle, one was true-and-structural. The one real defect — finding 3 above — went unmentioned,
because it is a property of the judge's own output pipeline that no bundle can show it.

This reproduces `handoff-59` KD4 exactly. The operative discipline is not "discount low
confidence" but "check every finding against stored data, then ask what the judge could not
see". Both halves paid here: two findings refuted, one defect found only by reading the
persisted assessment field by field.

## 9. What worked, and is worth repeating

- **A probe finalized BEFORE dispatch and never shown to any implementer** went 3-red at
  baseline to 6-green post-merge, with three must-accept controls. One control initially
  failed for an UNRELATED reason (an oracle-file precheck refusing a nonexistent path) — a
  control that cannot pass for the right reason is a broken probe, not a finding, and fixing
  that was what made the green meaningful.
- **A second probe was written as prose and left unwired**, which is indistinguishable from no
  probe. Wiring it took three iterations against real refusals (missing claim → unapproved
  command → success) and then required proving non-vacuity directly: the marker sits at stream
  index 0 of 22738 chars, so the pre-change last-4000 window provably cannot contain it.
- **Asking implementers to enumerate per-file whether a pre-existing test edit changed an
  assertion** surfaced a genuine coverage defect one agent had exposed and fixed (three tests
  that never checked `addEvidence`'s return value would have passed vacuously under the new
  guard).
- **The new guard caught a real tail-less row in a CONCURRENT session's code within minutes of
  merging** — a stronger signal than any of its own tests.

## 10. My own AC had an unsatisfiable premise, and its green was false

The second assessment (the one with a diff supplied) found what I did not: **AC-AEP-2's
premise cannot hold.** `truncateSection(task.content, budgets.max_task_chars)`
(`assess-template.ts:548,818`, whose own comment reads "task.content ALONE is what
participates in max_task_chars") measures the task BODY only; the rendered evidence block is
appended OUTSIDE that budget at `:558`. So projecting evidence rows can never move a task out
of `truncated[]` — the thing AC-AEP-2 asserted it would.

This propagates backwards into the diagnosis: the original incident's
`truncated: task:<slug>` was NOT caused by the 10 evidence rows. It was the task body. NS2's
premise ("10 rows overflowed the assess bundle") was wrong, and I encoded the wrong premise
into an AC. The implementer TOLD ME it could not satisfy the clause as written — its report
said it "re-proved AC-AEP-2 as a size fact on the assembled block rather than via the
truncation flag" — and I read that sentence without drawing the conclusion.

The projection's value survives (the evidence block is unbudgeted, so bounding it is real,
and `tail_bytes` visibility is what would have surfaced the empty tails). What did not
survive is the AC. Corrected via `lore ac set` to state what is actually measured and that
the truncated[] clause was WITHDRAWN, not satisfied.

**Standing lesson**: when an implementer reports "I re-proved AC-N a different way", that is
not a note — it is a claim that the AC as written was unsatisfiable. Treat it as a
spec-defect report and re-derive the premise from the code before accepting the green.

## 11. Non-empty is not genuine, and an opt-in floor is only as strong as the opt-in

Two measurements from the wave immediately after the non-empty-tail guard shipped:

- One task's tails were hand-authored narrative — `"8 tests matched (AC-AEP-1 lone token),
  all passed: Test Files 1 passed, Tests 8 passed (8) …"` — with real numbers embedded. It
  satisfies the non-empty predicate, would satisfy a runner-summary shape check, and is
  indistinguishable in the record from a capture. Later rows on the SAME task carry genuine
  vitest output, so capability was never the constraint.
- The task that COMPLETED the suppression mechanism archived with four rows, all `pass`, zero
  reds — while its body demanded RED-first and its report quoted the genuine pre-fix failure
  it had observed. The red run happened and was never persisted. `done()`'s red-first floor
  demands a red row only when `extra.red_first: true`, set exclusively by an explicit
  `lore red-first` call; that call was never made, so the floor never evaluated.

`lore verify` already captures its own tails — the self-report path simply has no equivalent.
Filed as one task: `task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the`.

## 12. Supplying the diff is the single largest lever on assessment quality

Same session, same judge, two assessments. The first ran with `diff_available=false` (see
finding 4) and produced one FALSE major, one partly-false minor, and missed the real defect.
The second ran with a diff built from exactly the plan's four task commits and produced six
findings of which every one checked out as true — including two I had missed and one that
overturned my own premise (finding 10).

The corollary: a plan-scoped diff must be built from the plan's OWN task commits, not a
contiguous range. This session's patch was assembled per-commit for that reason, and the
too-wide-range heuristic still warned ("8 files, only 2 intersect this plan's task anchors")
— a FALSE POSITIVE, because declared anchors name source files and six of the eight were
tests. The heuristic cannot currently distinguish "range too wide" from "tests are not
declared anchors".

## 13. Smaller, still mechanizable

- Two agents independently collided on a generic `/tmp/test-changed.txt`, producing an
  interleaved result file one of them correctly refused to trust. Under concurrent worktree
  dispatch, temp paths must be agent-unique; the dispatch bundle should say so.
- `ASSESS_TEMPLATES[5]` still binds the projected renderer, so a stamped `prompt_version: 5`
  does not reproduce — the identical break that justified freezing v6, left open one slot
  over. Two JSDoc sites (`:11-12`, `:1011`) meanwhile assert `5` IS "the frozen v5 entry",
  which is false. The knot is real: the registry's pre-existing policy says v5 needs no
  byte-identical guarantee, AND this spec's own AC-AEP-4 actively REQUIRES v5 to render the
  same projected shape as the active version — so freezing v5 would put two ACs of one spec
  in conflict. I first recorded this as an accepted hole; the second assessment was right that
  a false doc comment makes that untenable. Filed:
  `task-assess-templates-5-binds-the-projected-renderer-while-two`.
