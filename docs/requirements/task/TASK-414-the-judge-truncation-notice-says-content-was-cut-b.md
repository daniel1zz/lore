---
id: TASK-414
type: task
role: plan
title: "The judge truncation notice says content was cut but never which sections — section ORDER decided a verdict, and manual reordering is the only remedy"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Defect

The judge's truncation notice tells it that content was cut, but not WHAT was cut. The
notice is therefore unactionable, and the judge confabulates about the missing region
anyway — measured, not hypothesised.

Measured at HEAD `f3242aa`:

- Doc body budget: **12,000 characters**; parent context budget: **8,000** (`ai-provider-service.ts`).
- When truncation occurs the prompt gains a `# Truncation Notice` section
  (`review-template.ts`) instructing the judge to *"Treat the FULL document as present but
  unseen … do NOT conclude a section is missing, incomplete, or absent merely because it
  isn't visible here."*
- The judgment is stamped `truncated: true` (`ai-provider-service.ts`).

So the mitigation exists and is explicit. It still failed:

| Run | Doc version | Outcome |
|---|---|---|
| 5 | 36 | blocking: *"Where is D7 declared? Not in Design Decisions section"* |
| 6 | 38 | blocking: *"Document body beyond Contract Details was not shown to me"* |
| 7 | 40 | `approve` 0.76, zero blocking questions |

Nothing about the decision changed between run 6 and run 7. What changed is that D7's
summary was **moved earlier**, into the Design Decisions section, inside the first 12k
characters. Section ORDER decided the verdict.

## Mechanism root

Truncation is positional — it keeps a byte prefix. Whether a load-bearing section
survives is therefore an accident of where an author happened to put it, and nothing
detects or reports the mismatch. The notice asks the judge to reason about an absence it
cannot characterise: it is told *something* is missing, never *which sections*.

⛔ The current remedy — an author manually reordering sections so decision-carrying
material lands inside the window — is a workaround, not a mechanism. It is invisible,
unenforced, and has to be rediscovered by every future author. Prose in a prompt asking
the judge not to draw a conclusion is exactly the layer that already failed here.

## Requirement

The judge must be able to tell a section that is ABSENT from one that is merely UNSEEN.

Enumerate the section headings of the full document and pass the list of headings that
fell outside the window, so the notice names them (e.g. *"sections not shown: D7, Rollout,
Appendix"*). A judge holding that list can distinguish "not declared anywhere" from "declared
past the cut", which is precisely the distinction runs 5 and 6 got wrong.

Consider, and decide explicitly in the completion report, whether the window should also
prefer decision-carrying sections over a plain byte prefix. Do not implement a semantic
ranker without saying why it beats the heading-list fix — the heading list is the smaller
change that addresses the measured failure.

⛔ Enlarging the 12k budget is NOT a fix and must not be the primary change: it moves the
cliff without removing it, and the next document that exceeds the new budget reproduces
the defect exactly. If the budget changes, it changes as a config value with a stated
rationale, alongside the real fix.

## Oracle

- A document whose sections exceed the budget produces a truncation notice that NAMES the
  omitted section headings. Assert on a heading string that is known to fall outside the
  window.
- CONTROL, so the assertion cannot pass vacuously: a document that fits entirely inside
  the budget emits NO truncation notice and no heading list.
- BOUNDARY: a document sitting exactly at the budget edge, and one whose FIRST section
  alone exceeds it (no heading survives), each produce a loud, named outcome rather than
  an empty list rendered as "nothing omitted" — an empty list that reads as "complete" is
  the false-green form of this defect.
- REGRESSION: `truncated: true` is still stamped on the persisted judgment, and the
  existing notice text's instruction is preserved.
- The heading list is derived from the FULL document, never from the truncated copy —
  a list computed post-cut can only ever name headings that survived, which is vacuous.
  Assert this directly.

## Non-goal

This task does not change D5's blocking semantics — see
`adr-judge-flakiness-keep-d5-unchanged-explicit-human-dismissal`. A truncation artifact is
a distinct failure from a sampling flip, and conflating them was what made the flip look
more frequent than the evidence supports.
