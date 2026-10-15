---
id: SPEC-127
type: spec
role: spec
title: "Evidence output_tail integrity: a self-reported row must carry captured output (non-pass since 2026-08-01, pass since 2026-08-03), and a runner tail must witness the criterion it is filed under"
status: approved
priority: high
created: 2026-08-01
updated: 2026-10-10
tags: []
---
# Evidence output_tail integrity: a self-reported non-pass row must carry output, and a runner tail must witness the criterion it is filed under

## Overview

An evidence row's `output_tail` is the only part of the record that can show WHY a run
came out the way it did. Two independent holes let a row be filed with no such showing,
and both were measured on live corpus data rather than reasoned about:

1. **A self-reported `fail` row may carry no output at all.** `lore evidence --result fail`
   accepts an absent `output_tail`. Measured 2026-08-01 on
   `plan-implementation-resume-coverage-floor-satisfaction`: both red-first rows
   (`AC-RCS-1`, `AC-RCS-2`) stored `tail bytes: 0`, so the red-first claim rests on the
   row's existence and its command string and on nothing that was observed. The dispatch
   bundle asked for the red output in prose; the ask was silently dropped by both agents.
   Recurrence measured the same day on `task-test-changed-cannot-see-the-whole-integration-cli-tier-the`:
   all 6 rows, `tail bytes: 0`.
2. **A runner-produced tail is the literal END of the stream, not the part about the AC.**
   `verify-executor.ts:150` computes `tailChars(stdout + stderr, OUTPUT_TAIL_MAX_CHARS)`.
   When a run emits more output than the cap after the AC's own result line, the stored
   tail witnesses some unrelated later portion of the stream, while the criterion the row
   is filed under has scrolled out of the window.

This is the same family CLAUDE.md already catalogues under false oracles: a record that
is exit-code-true but did not measure the right thing. Here the record is
`result`-true but shows nothing, or shows the wrong slice.

## Scope

IN scope:

- The SELF-REPORTED evidence write path only — `TaskWorkflowService._addEvidenceImpl` and
  its phase-tier twin `PhaseWorkflowService._addEvidenceImpl`. These already host three
  self-report-only guards (own-property `attestation` rejection, `inconclusive` rejection,
  `rejectPlaceholderEvidenceCommand`); this adds a fourth alongside them.
- The runner's tail SELECTION for attested rows — `verify-executor.ts` /
  `verify-runner-service.ts`.

OUT of scope, deliberately:

- **The shared `appendEvidenceEntry` chokepoint.** A non-empty-tail rule placed there would
  also bind `recordVerifiedEvidence`, and a runner-attested `fail` can legitimately carry an
  empty tail: `verify-executor.ts:150` yields `""` whenever the child wrote nothing to
  stdout+stderr — a silent nonzero exit, a `--quiet` tool, or a TIMEOUT that killed the
  process before it flushed. Binding the chokepoint would abort `lore verify` at that AC
  (`verify-runner-service.ts:770` early-returns on a failed record) and convert a reportable
  failed AC into a partial-abort error. This asymmetry is not an oversight to harmonise
  later — it is the same decision `evidence-precheck.ts:415-421` already documents: the
  runner independently observed the exit code, `lore evidence` observed nothing.
- `result: "inconclusive"` — already unreachable from self-report
  (`_addEvidenceImpl` hard-rejects it); it is runner-issued only.
- The `lore set` / HTTP `PATCH /api/docs/:id` route that can replace `extra.verification_evidence`
  wholesale. It is a real hole (`corpus-service.ts:206-228` refuses only a DROP, not a
  replace) but it is a general structured-extra-integrity problem, not a tail problem, and
  fixing it here would scope-creep this slice. Filed separately.

## Design Decisions

**D1 — the rule binds `fail` AND `expected-fail`, not `fail` alone.** Both are non-pass
self-reports whose entire evidentiary value is the captured output. `expected-fail` is
the deliberate-RED vocabulary from
`spec-workflow-hardening-evidence-red-vocabulary-claim-worktree` §M1, which is precisely
the case that motivated this spec.

**D2 — REVERSED 2026-08-03: `pass` rows ARE bound by this rule.** As originally written this
decision read "`pass` rows are NOT bound by this rule", reasoning that a filtered `pass` was
already covered by `findFilteredPassRefusal` (`evidence-precheck.ts:527`), that an unfiltered
pass was a separately-catalogued gap whose fix was not a tail requirement, and that widening
would collide with that guard and change its error vocabulary. That widening landed anyway
(`task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the`, merge `82157f3`) and the
predicted collision did not materialise — the guards compose, each keeping its own vocabulary.
The reversal was forced by measurement, not preference: two independent implementers each
recorded 8 `result: pass` rows with zero-length tails, and the pass row is the one that unlocks
archival, so leaving it unguarded made the non-pass guard cosmetic. See AC-ETI-4, which now
pins the widened behaviour instead of the exemption it originally pinned. The decision is
corrected in place rather than deleted: an implementer reading only this section must not be
led to rebuild the superseded behaviour.

**D3 — "non-empty" means non-empty after trimming.** A tail of `"\n"` or spaces satisfies
a naive length check while showing nothing, and is exactly what a shell capture of a
silent command produces. Reuse the `tail.trim().length === 0` test
`findFilteredPassProofGap` (`evidence-precheck.ts:466`) already applies.

**D4 — the runner prefers an AC-witnessing window, and says so when it cannot find one.**
When the row carries an `ac_ref` and the AC id occurs in the captured stream, the stored
tail is the window AROUND the last occurrence of that id rather than the stream end. When
the id does not occur, behaviour is unchanged (stream tail) — silently, because a run
whose output never names the AC is normal for many oracle kinds.

## Acceptance Criteria

Structured, machine-checkable criteria are declared via `lore ac add` and are the
authority. Prose restatement here is a reader's summary only.


## Acceptance Criteria (structured)

- [⚑] [script] AC-ETI-1: A self-reported evidence write with result=fail and no output_tail is rejected with a VALIDATION_ERROR whose field is output_tail; the row is not appended.
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-nonpass-tail.test.ts -t 'AC-ETI-1'
- [⚑] [script] AC-ETI-2: A self-reported result=fail whose output_tail is whitespace-only is rejected identically to an absent one (emptiness is tested after trimming, per D3).
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-nonpass-tail.test.ts -t 'AC-ETI-2'
- [⚑] [script] AC-ETI-3: A self-reported result=expected-fail with no output_tail is rejected on the same predicate as fail (D1).
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-nonpass-tail.test.ts -t 'AC-ETI-3'
- [⚑] [script] AC-ETI-4: A self-reported result=pass whose output_tail is absent or whitespace-only is REFUSED with a VALIDATION_ERROR naming output_tail, and no row is appended. WIDENED 2026-08-03 (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the, merge 82157f3) from this criterion's original form, which was the opposite CONTROL asserting the pass path stays exempt — that exemption was deliberately reversed, because the pass row is the one that unlocks archival and two implementers were measured recording 8 zero-tail pass rows each. Reversal recorded in place rather than by deletion so it stays auditable.
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-nonpass-tail.test.ts -t 'AC-ETI-4'
- [⚑] [script] AC-ETI-5: CONTROL: a runner-attested result=fail carrying an empty output_tail is still appended successfully via recordVerifiedEvidence — proving the predicate binds the self-report path only and cannot abort lore verify on a silent or timed-out command.
  script: test — bunx vitest run packages/lore/tests/unit/service/task-workflow-nonpass-tail.test.ts -t 'AC-ETI-5'
- [⚑] [script] AC-ETI-6: The phase-tier self-report path (PhaseWorkflowService._addEvidenceImpl) rejects a tail-less non-pass row identically to the task tier, so the phase fallback in commands/evidence.ts does not bypass the rule.
  script: test — bunx vitest run packages/lore/tests/unit/service/phase-workflow-nonpass-tail.test.ts -t 'AC-ETI-6'
- [⚑] [script] AC-ETI-7: When an evidence row carries an ac_ref and that AC id occurs in the captured stream earlier than the final OUTPUT_TAIL_MAX_CHARS window, the stored output_tail contains that AC id (the window is taken around the id's last occurrence, not the stream end).
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-tail-witness.test.ts -t 'AC-ETI-7'
- [⚑] [script] AC-ETI-8: CONTROL: when the ac_ref id does not occur anywhere in the captured stream, the stored output_tail is byte-identical to the pre-change stream-tail result.
  script: test — bunx vitest run packages/lore/tests/unit/service/verify-tail-witness.test.ts -t 'AC-ETI-8'
