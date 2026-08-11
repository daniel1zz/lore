---
id: TASK-391
type: task
role: plan
title: "A non-empty output_tail can be hand-authored prose, and the red-first archive floor is opt-in — the record's form is satisfied while its evidentiary content is absent"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: ADR-028, type: relates-to}
---
Direct successor to `spec-evidence-output-tail-integrity-a-self-reported-non-pass` (landed
2026-08-01). That slice made a self-reported non-pass row carry a NON-EMPTY `output_tail`.
Two measurements from the very next wave show non-emptiness is not the property that matters.

## Measurement 1 — a prose summary satisfies the new guard perfectly

`task-t3-project-evidence-rows-as-oracle-ac-ref-result-command`, rows 2-5 and 8-13, stored
tails like:

    "8 tests matched (AC-AEP-1 lone token), all passed: Test Files 1 passed,
     Tests 8 passed (8) -- HAPPY/BOUNDARY x3/STATE/NEGATIVE/ERROR/REGRESSION all gr…"

That is hand-authored narrative with real numbers embedded, not captured command output. It
passes the non-empty predicate, passes `parseExecutedUnits` (it contains a runner-summary-
shaped substring), and is indistinguishable in the record from a genuine capture. Later rows
[14]-[17] on the same task DO carry real vitest output, so the same agent produced both forms
— the difference was not capability.

A paraphrase in `output_tail` is exactly the substitution the assess-projection spec was
written to expose, reappearing one layer down.

## Measurement 2 — the red-first archive floor is opt-in, so skipping the declaration skips the floor

`task-t6-suppression-removes-only-the-dimension-scores-row-so` archived carrying FOUR
evidence rows, all `result=pass`, zero reds — while its own task body opened with
"RED first: … before the fix, still carry that typed gap", and its completion report QUOTED
the genuine pre-fix failure text it had observed
(`expected ['scope_fidelity','outcome'] to not include 'scope_fidelity'`).

The red run happened. It was never persisted. Six weeks from now the transcript is gone and
the corpus says four passes.

`done()`'s red-first floor (landed the same day, `293ec2d`) demands >=1 `expected-fail`/`fail`
row — but ONLY for a task carrying `extra.red_first: true`, which is set exclusively by an
explicit `lore red-first` call. T6 never made that call, so the floor never evaluated. An
opt-in floor is only as strong as the opt-in, and nothing prompts for it.

## Why these are one task

Both are the same shape: the record's FORM is satisfied while its EVIDENTIARY CONTENT is
absent. Fixing either alone leaves the other as the open path.

## Design questions the implementation must settle

1. **How does a tail get attested as captured rather than authored?** Options, weakest to
   strongest: (a) reject tails that fail a runner-summary shape check — weak, T3's prose
   passes it; (b) have the CLI capture the tail itself (`--capture -- <cmd>`), so the agent
   never types it, and mark such rows `capture_source: "runner"`; (c) restrict the
   self-report path to a tail read from a file the recorder did not author in the same
   turn — hard to define. (b) is the only one that removes the substitution rather than
   testing for it. Note `lore verify` ALREADY does exactly (b) for its own rows; the gap is
   that the self-report path has no equivalent.
2. **Should red-first be opt-OUT rather than opt-in?** A task that declares an AC and records
   only passes is the common case worth questioning; a task that legitimately adds no new
   test is the exception. Inverting the default makes the floor fire by construction, at the
   cost of an explicit "no new tests" declaration on such tasks. Decide, and mechanize
   whichever way — do not leave it to prose in dispatch bundles, which is precisely what
   failed here for the second time in two days.

## Oracle

- RED first: a self-reported row whose `output_tail` is a hand-authored paraphrase is
  currently ACCEPTED; after the fix, the chosen mechanism either refuses it or records it as
  unattested in a way `lore assess`'s `attested_evidence_ratio` reflects.
- CONTROL: a row whose tail IS captured output is accepted unchanged.
- CONTROL: `lore verify`'s runner-attested rows are unaffected (they already capture).
- RED first: a task with a declared AC and zero non-pass rows currently archives cleanly;
  after the fix it either cannot, or must carry an explicit no-new-tests declaration.
- CONTROL: a task that legitimately adds no test still archives, via that declaration.
- CONTROL: the existing `extra.red_first` opt-in path keeps working byte-identically for
  tasks that DO declare it (`293ec2d`'s ACs stay green).


## Proxy / Silence / Opt-in — ADR three-question review (2026-08-01, agent:main-orchestrator)

Answered per `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` BEFORE
implementation. Both design questions above are hereby SETTLED, not left to the implementer.

**Q1 Proxy — option (b) closes the gap; (a) and (c) are proxies and are REJECTED.**
(a) a runner-summary shape check: the measured T3 prose PASSES it — a proxy already exploited
by accident, and re-adopting it would only raise the bar on the paraphrase, not remove the
substitution. (c) "a tail read from a file the recorder did not author this turn": unenforceable
— the recorder can author the file. (b) CLI-side capture (`--capture -- <cmd>`) makes the tail
the runner's actual stdout, which IS the property, and `lore verify` already does exactly this,
so the shape is proven in-tree rather than invented here.

**Q2 Silence — the residual self-report path must be MARKED, never silently equivalent.**
Deleting the hand-authored path is not available: `lore evidence` stays a self-report ledger BY
DESIGN (`adr-lore-done-requires-a-runner-attested-pass-the-sixth-false`), so both forms will
coexist permanently. Required: `capture_source` is a REQUIRED discriminator on every row
(`"runner"` vs `"self-report"`), never defaulted and never inferred from the tail's shape — an
inferred discriminator is just proxy (a) wearing a field name. Absence in the back-catalogue
reads as `"self-report"`, NOT as unknown-therefore-fine. A row's provenance must be readable
from the record alone, without the transcript.

**Q3 Opt-in — the ADR's answer to design question 2 is not ambiguous: INVERT the floor.**
The red-first floor evaluates only for `extra.red_first: true`, set exclusively by an explicit
`lore red-first` call that nothing prompts for. T6 skipped the call and thereby skipped the
floor. An opt-in floor constrains exactly the population that did not need constraining — this
is Q3's textbook case, and prose in dispatch bundles has now failed at it twice in two days.
**Decision: make it opt-OUT.** A task carrying at least one AC and zero non-pass rows cannot
archive without an explicit recorded no-new-tests declaration. That declaration takes the
audited-escape shape this repo already uses (`lore approve --override-judgment`, `lore outline
exempt --reason`): mandatory free-text, persisted verbatim onto the audit entry, no env-var
form. Loud and permanent, never a silent skip.

**⛔ Concurrency note — RE-MEASURE before dispatch; do not trust this paragraph.**
Between 21:19 and 21:41 on 2026-08-01 a CONCURRENT orchestrator session — resolving to the SAME
`agent:main-orchestrator` actor as this review's author, so invisible in `active_sessions` — ran
four agents in `.claude/worktrees/agent-{a0bd2615…, a313f70c…, a63979673…, adcccee23…}` and merged
two of them into `main` mid-review: `main` moved `63c3537` → `955c26d` in four minutes.
The files this task must touch were inside that window's write set:
- `packages/lore/src/adapters/cli/commands/evidence.ts (the capture half)`
- `packages/lore/src/adapters/cli/evidence-precheck.ts (the capture half)`
- `packages/lore/src/service/task-workflow-service.ts (`done()`'s red-first floor)`

⛔ Whether they are STILL contended is not knowable from this document. `--porcelain` and
ahead-counts are not durable facts — the first version of this very paragraph asserted
"uncommitted, branch empty" about worktrees that were merged before it was four minutes old.
Before dispatching, re-measure:

    git worktree list && git log --oneline -3
    for w in $(git worktree list --porcelain | awk '/^worktree/{print $2}'); do \
      printf '%s: %s dirty, %s ahead\n' "$w" \
        "$(git -C "$w" status --porcelain | wc -l)" \
        "$(git -C "$w" log --oneline main..HEAD 2>/dev/null | wc -l)"; done

Then re-read the MERGED state of the files above: a landed concurrent change may have moved the
seam this task's fix targets. See `task-lore-handoff-reports-modified-files-none-while-four`.

⛔ `done()`'s floor ORDERING is being changed by concurrent work (an attested-pass floor landing adjacent to the red-first floor). Read the MERGED `done()` JSDoc for the floor-precedence contract before touching it — it states which floor precedes which.


## Measurement 3 — the prose layer was tested directly, twice, and failed twice (2026-08-01, orchestrated session)

This task's design questions were already settled by the three-question review above. What follows
is new EVIDENCE about which layer the fix must land on, obtained by accident: an orchestrator
dispatched two independent implementers and put the discipline in the dispatch bundle as prose.

**Dispatch 1** (`task-lore-assess-derives-a-plan-s-commits-by-grepping-task`) — the bundle said
"record evidence, then release", without naming the tail. Result: **8 evidence rows, all
`result: "pass"`, all `output_tail` length 0, all `attested: false`, all `ac_ref: null`.**

**Dispatch 2** (`task-verifying-a-handoff-you-just-authored-arms-the-coverage`) — the bundle was
strengthened with an explicit, unmissable instruction that named the failure, the fix, the flag,
and the precedent verbatim:

> ⛔ Your `lore evidence` rows MUST carry a real captured tail. Use `--output-tail-file <logfile>`
> pointing at the actual redirected output of the command you ran. Do NOT hand-author a tail, and
> do NOT leave it empty: the sibling task that shipped an hour ago recorded 8 pass rows with EMPTY
> tails, which is precisely the defect family this corpus is closing.

Result: **8 evidence rows, all `result: "pass"`, all `output_tail` length 0.** Same count, same
shape, same emptiness — from a different agent, under an instruction that cited the first failure
as a warning.

Both implementers did real, verifiable work (both branches merged after the orchestrator re-ran
every oracle itself on merged `main`). Neither was careless in its engineering. The discipline
simply did not survive the trip from bundle prose to the `lore evidence` call site.

**Not a discipline failure — measured.** Dispatch 1's implementer, in its own closing report,
described those rows as "8 evidence rows recorded against real oracle output". It had in fact run
every oracle (the orchestrator re-ran all of them on merged `main` and got the same greens), so the
statement was sincere. The rows still carried nothing: `output_tail` length 0 on all eight. So the
gap is not honesty and not capability — it is that an agent can believe it has recorded evidence
while the record it produced contains no evidence, and no layer between the intent and the store
disagrees with it. Attributing this to carelessness would misdiagnose it and lead to another round
of stronger prose, which Measurement 3 already shows does not work.

## What this changes about the required fix

1. **A capture path that is merely AVAILABLE is not enough.** `--output-tail-file` already existed
   during dispatch 2 and was named in the instruction. It was still not used. So option (b) as
   originally scoped — "have the CLI capture the tail itself, so the agent never types it" — must
   be the DEFAULT or the ONLY path for a `result: pass` row, not an opt-in flag beside the old one.
   An optional capture flag is Question 3's opt-in failure wearing different clothes.
2. **The asymmetry is the mechanism gap.** `spec-evidence-output-tail-integrity-a-self-reported-non-pass`
   made a self-reported NON-PASS row require a non-empty tail. A self-reported PASS row has no such
   requirement — which is backwards: the pass row is the one that unlocks archival. Sixteen rows
   across two tasks exercised exactly that hole, and no predicate anywhere objected.
3. **Prose is measurably the wrong layer here**, in the CLAUDE.md sense ("prose that should have
   been followed is not a mechanism, and a defect already covered by existing prose is proof that
   the prose layer is the wrong layer"). This task therefore MUST land as a refusal or a forced
   capture at the `lore evidence` boundary. A stronger dispatch template is not an acceptable
   substitute and would be the third failure of the same kind.

## Oracle additions implied by Measurement 3

- RED first: `lore evidence <task> --oracle test --command "<cmd>" --result pass` with NO tail flag
  is currently ACCEPTED and stores `output_tail: ""`. After the fix it must either refuse (naming
  the capture command) or capture the tail itself. Assert the STORED tail is non-empty and matches
  real runner output — not merely that the call succeeded.
- CONTROL: the non-pass path landed by the predecessor spec stays byte-identical.
- CONTROL: a row whose tail IS captured (`--output-tail-file`) keeps working unchanged.
- BOUNDARY: a pass row for `--oracle manual` (a browser/visual check with no capturable stdout)
  must remain possible — that is the legitimate exception, and it needs its own explicit,
  auditable declaration rather than a silently empty tail.
