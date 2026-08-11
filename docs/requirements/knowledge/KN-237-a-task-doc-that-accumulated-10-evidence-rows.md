---
id: KN-237
type: knowledge
role: knowledge
title: "A task doc that accumulated 10 evidence rows overflowed the assess bundle, and the judge reported truncation artifacts as findings while missing the one real shortfall"
status: approved
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-084
links:
  - {id: KN-238, type: relates-to}
---
# A task doc that accumulated 10 evidence rows overflowed the assess bundle, and the judge then reported truncation artifacts as findings while missing the one real shortfall

## What happened

`lore assess plan-implementation-resume-coverage-floor-satisfaction` ran after
every evidence row had landed (per the sequencing rule from
`knowledge-close-out-findings-assess-must-be-the-last-step-and`). It returned
`Overall confidence: low (degraded by truncation)` and self-reported
`truncated: task:task-both-satisfaction-side-tightenings-a-deferral-needs-a-non`
— the single task doc, carrying 10 evidence rows, did not fit the bundle.

Two of its four typed gaps are artifacts of exactly that truncation, and both
are checkable against the stored corpus data:

| judge's claim | measured against the stored doc |
|---|---|
| "The independent merge-time probe's recorded `output_tail` **ends inside the S1 block**. AC-RCS-2 therefore rests entirely on implementer-authored tests" | The stored `output_tail` is 1022 bytes and contains the `S2 / AC-RCS-2` heading, the final `ALL PASS` verdict, and **5** `ids=[KD1,NS1]` set-equality lines spanning BOTH S1 and S2 cases |
| "Test counts … do not prove set-equality of named ids … only the probe's `ids=[...]` lines demonstrate that, and **only for S1**" | Same measurement — the S2 sidechain-only case asserts the id set too |

A third gap (`scope_fidelity` major, `diff_available=false`) is a true statement
about the BUNDLE, not about the work: the two-file confinement WAS verified
before merge (`git show --stat e33c2f6` and `git diff --stat main...<branch>`
both reporting exactly `handoff.ts` +48/-6 and the one test file +142), but that
verification lives in the orchestrator's shell history, not in the corpus. The
judge is right that the record cannot show it. Its own rubric flagged the
finding as ungrounded (`based_on="absence"` with no matching `unverifiable[]`
entry), which is the judge catching itself.

## The real shortfall the judge did NOT report

Both red-first rows carry an EMPTY `output_tail`:

```
--- test fail | ac: AC-RCS-1 | tail bytes: 0
--- test fail | ac: AC-RCS-2 | tail bytes: 0
```

The dispatch bundle asked explicitly for the red output in those rows. Without
it, the red-first claim rests on the row's existence and its command string, not
on any captured evidence that the run was red FOR THE REASON the AC pins — which
is the entire point of recording the red. `AC-RCS-3`'s first pass row is empty
too. The judge, working from a truncated view and reasoning about the ACs it
could see, never looked at which rows carried a tail at all.

## Why this matters beyond one plan

Three compounding mechanisms, none of which fires loudly today:

1. **Evidence volume degrades the audit of that same evidence.** Rows accumulate
   monotonically (append-only, max 50), so the MORE thoroughly a task is
   evidenced, the more likely its doc overflows the assess bundle and the LOWER
   the resulting confidence. Acting on the judge's advice by recording still more
   evidence makes the next assessment worse, not better — and additionally
   invalidates the current one via `plan-close`'s `ASSESSMENT_STALE`.
2. **Truncation is reported as a confidence degradation, not as a refusal.** The
   assessment persists as the corpus's permanent quality record, and the false
   claims inside it read exactly like the true ones. Nothing downstream
   distinguishes "the judge did not see this" from "the judge saw this and found
   it wanting".
3. **`output_tail` is optional per row, and nothing measures how many rows have
   one.** An empty tail is indistinguishable from a tail nobody looked at. This
   is the same family as the already-filed
   "`output_tail` should witness its own criterion" item (handoff-55 NS3): that
   one is about the tail slice being the WRONG part of the stream; this one is
   about there being no slice at all.

## Recommended mechanizations (recorded, NOT built)

- **Refuse rather than degrade**: when the bundle truncates a doc whose ACs the
  judge is scoring, emit the truncated doc set as a hard `unverifiable[]` entry
  per affected AC, so a gap can never be authored against content the judge did
  not read. Cheaper variant: forbid `based_on="absence"` findings for any AC
  whose evidence source was truncated — the existing rubric warning already
  detects the ungrounded shape but does not suppress the finding.
- **Project evidence rows into the bundle instead of embedding the doc**: send
  `(oracle, ac_ref, result, command, tail_bytes)` per row plus the tails for the
  rows under judgment, rather than the whole task body. Row COUNT and
  `tail_bytes` are exactly what would have surfaced the real shortfall above.
- **Require a non-empty `output_tail` on every `result: "fail"` row.** A fail row
  with no output cannot show WHY it failed, so it cannot support a red-first
  claim. This is a `TaskWorkflowService` write-side predicate, not prose — the
  dispatch bundle already asked for it in prose and the ask was silently dropped.

## Standing lesson

**An LLM judge's confidence degradation is not a discount to apply to its
findings — it is a signal that some findings may be about the judge's own
truncated view.** Check every gap against the stored data before accepting it,
and check what the judge did NOT look at: here, two of four findings were false
against the corpus, one was true-but-about-the-bundle, and the one real defect
(empty `output_tail` on both red-first rows) went unmentioned entirely. This is
the checklist-is-a-floor lesson applied to a judge: after reading its findings,
ask what it could not see.
