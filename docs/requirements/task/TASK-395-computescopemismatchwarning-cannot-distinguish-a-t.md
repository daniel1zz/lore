---
id: TASK-395
type: task
role: plan
title: "computeScopeMismatchWarning cannot distinguish a too-wide range from tests never being declared anchors — it false-positives on every plan whose tasks ship tests, and exempts the anchor-less plans most likely to be wrong"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: ADR-028, type: relates-to}
---
Filed per `knowledge-handoff-agent-main-orchestrator-69` NS9, reviewed through
`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` before filing.

## The defect (source read 2026-08-01, `packages/core/src/assessment.ts:682-700`)

    export function computeScopeMismatchWarning(diffFiles, taskAnchors) {
      if (taskAnchors.length === 0) return undefined;
      if (diffFiles.length === 0) return undefined;
      const intersectingCount = diffFiles.filter((f) => anchorsOverlap([f], taskAnchors).overlaps).length;
      if (intersectingCount >= diffFiles.length / 2) return undefined;
      return { …, message: "⚠ diff touches N files, only M intersect this plan's task anchors — the range may be too wide; derive it from the plan's own task commits." };
    }

The predicate is "strictly fewer than half the diff's files intersect the plan's declared task
anchors". The message asserts a cause: **the range may be too wide.**

But a task's `file_anchors` declare its IMPLEMENTATION surface. Test files are essentially
never declared as anchors — this repo's own dispatch discipline declares source paths so the
`noAnchorOverlap` gate can serialize writers, and two agents adding tests beside the same
source file is not the collision anchors exist to prevent. Meanwhile every task in this repo
ships tests by mandate (six-dimension coverage, and both runners for anything touching
`bun:sqlite`).

So a perfectly-scoped plan whose every task shipped one source file plus two test files scores
`intersecting = 1/3` per task and trips the warning — with a message blaming the range.

**Measured twice in the 2026-08-01 session**: 17 files / 4 intersecting anchors, and 8 files /
2 intersecting anchors. Both plans were correctly scoped; both warnings were false. The
function cannot distinguish "the range is too wide" from "tests are not declared anchors",
because both produce the identical low-intersection ratio.

## Proxy / Silence / Opt-in — ADR three-question review

**Q1 Proxy — the ratio is a proxy for range-width and the false-positive rate is not
incidental, it is structural.**
Concrete input satisfying the proxy while violating the property: any correctly-scoped plan
whose tasks ship more test files than source files — which, under this repo's own six-dimension
test mandate plus its two-runner rule, is the COMMON case, not the edge case. This gap is NOT
accepted: a warning whose false-positive rate exceeds its true-positive rate on the corpus it
ships in trains its reader to ignore it, which costs the three real incidents it was built for
(`task-assess-diff-range-scope-mismatch-warning`).
Direction of the fix: classify the non-intersecting files before scoring. A non-intersecting
file that is a TEST for an intersecting source file (its path maps to a declared anchor by the
repo's own test-file convention) is in-scope evidence, not scope drift. Files that are neither
declared anchors nor tests-of-declared-anchors are the actual signal. State the classification
rule explicitly and test it — a heuristic that silently mis-classifies is worse than the
current honest-but-wrong ratio.

**Q2 Silence — the anchor-less early return is the ADR's Question-2 shape and is the more
dangerous half of this defect.**
`if (taskAnchors.length === 0) return undefined;` — its JSDoc defends this as avoiding "pure
noise (many older plans declare none)". The consequence is that a plan declaring NO anchors,
assessed over a genuinely far-too-wide range, gets NO warning, and `undefined` is
indistinguishable downstream from "compared and fine". The one population most likely to have
a wrong range (older plans predating anchor discipline) is precisely the population exempted.
Required: an anchor-less plan yields an explicit not-measured marker
(`"not-measured: no task declares file_anchors"`), never `undefined`. Whether that marker
prints is a presentation choice; that it EXISTS as a distinct value is not.

**Q3 Opt-in — the mechanism is gated on a voluntary declaration.**
Whether this check runs at all depends on tasks having declared anchors, which is opt-in per
task. So the check constrains exactly the plans authored carefully enough to declare anchors,
and exempts the careless ones — Question 3's textbook inversion. Combined with Q2 above, the
close is the same: never return a bare `undefined` for the anchor-less case.

## Required

- Classify non-intersecting files (test-of-a-declared-anchor vs genuinely-out-of-scope) before
  applying the ratio, and re-word the message so it names WHAT it found rather than asserting
  a cause it cannot establish.
- Replace both bare `undefined` early returns with distinguishable outcomes. The `diffFiles.length === 0` return is the same shape and gets the same treatment.
- `computeScopeMismatchWarning` is pure and browser-safe (`@lore/core`, no IO, no wall-clock) —
  the classification rule must stay pure. Do NOT reach for the filesystem to decide whether a
  path is a test file; derive it from the path string, and pass any repo-specific convention in
  as a parameter rather than hard-coding this repo's layout into `@lore/core`.

## Oracle

- RED first: a fixture where every non-intersecting file is a test beside a declared anchor
  currently WARNS; after the fix it does not. Must fail before the fix.
- RED first: an anchor-less plan currently returns `undefined`; after the fix it returns the
  explicit not-measured value. Assert the VALUE, not merely that it is falsy.
- CONTROL: a genuinely too-wide range (non-intersecting files that are neither anchors nor
  tests of anchors) still warns, with a byte-identical count pair for the same input.
- CONTROL: the existing boundary case the JSDoc pins (exactly half intersecting → no warning)
  stays green, byte-identical.
- CONTROL: `packages/core` stays browser-safe — `packages/lore/tests/unit/core/barrel-isolation.test.ts` green, and no new `fs`/`path` import reaches the default barrel.
