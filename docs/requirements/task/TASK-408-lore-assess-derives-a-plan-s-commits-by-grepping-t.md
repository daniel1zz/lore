---
id: TASK-408
type: task
role: plan
title: "lore assess derives a plan's commits by grepping task slugs out of commit messages, a convention nothing enforces — a conventionally-worded commit yields zero, and the resulting diff_available=false manufactures a false major finding"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: ADR-028, type: relates-to}
---
## Measured 2026-08-01

`lore assess plan-implementation-evidence-output-tail-integrity-self-report` reported:

    Diff source: none — could not derive any commits for this plan's tasks

for a plan whose work demonstrably landed in main minutes earlier (`e60075f`, `ba70231`,
`8589e64`, plus the task commits `ffeba53`, `02f6691`, `2bf9bf5`).

Root cause: `deriveCommitSetForPlan` (`packages/lore/src/adapters/cli/assess-commit-derivation.ts:111`)
selects by `git log --fixed-strings --grep=<task-slug>`. It therefore requires every
implementation commit's MESSAGE to contain the task's slug. The commits above are
conventionally-worded Conventional Commits (`fix(evidence): self-reported fail/expected-fail
must carry a non-empty output_tail`) and contain no slug, so not one matched.

## Why this is worse than a missing diff

The zero result is not inert. It propagates:

1. `diff_available=false` reaches the judge bundle.
2. The judge scores `scope_fidelity` with `based_on="absence"`.
3. That produces a `major` typed gap asserting the plan's anchor/placement constraints
   "cannot be inspected" — a true statement about the BUNDLE, published as a defect finding
   against the WORK.
4. The rubric's own grounding check flags it as ungrounded, and (post-T4) suppresses the
   dimension score — but the typed gap still publishes (see
   `task-t6-suppression-removes-only-the-dimension-scores-row`).

So a silent convention mismatch manufactures a false major finding in the permanent quality
record. This is the third distinct route to that same outcome catalogued in two days.

## The gap is the CONVENTION, not the algorithm

The derivation is sound given its precondition. Nothing states, teaches, or enforces the
precondition:

- No gate, hook, or commit-message check requires a task slug in the message.
- The worktree-dispatch discipline in CLAUDE.md prescribes `lore evidence` / `lore release` /
  merge order in detail and says NOTHING about commit-message content.
- The dispatch bundles this session sent to five implementers said nothing either — because
  the orchestrator did not know.
- `assess-commit-derivation.ts:37` explicitly anticipates the squashed/rewritten-history
  case, so the authors knew the precondition was fragile; the missing piece is the
  producer-side half.

## Required — pick a direction and mechanize it, do not add prose

Candidates, in rough order of strength:

1. **Make the miss LOUD instead of silent.** `no_commits_found` for a plan whose tasks are
   all archived is a contradiction: archived tasks have merged work by definition. Emit a
   refusal or an `unverifiable[]` entry that says "derivation found no commits — the diff
   dimension was not scored", and FORBID absence-based scoring of `scope_fidelity` in that
   state, rather than letting the judge infer a defect. (Overlaps
   `task-t6-...`; coordinate.)
2. **Derive from something that cannot drift**: the task's `extra.file_anchors` union, or
   the claim's recorded worktree branch, instead of a free-text message convention.
3. **Enforce the convention at the producer**: have `lore done` (or the dispatch bundle
   template that ships in `assets/`) require/record the commit sha set on the task, so
   derivation reads a stored fact rather than grepping prose.

Option 3 alone is insufficient for the back-catalogue: every already-archived task in this
corpus lacks the slug in its commits, so any fix must state what happens to them.

## Oracle

- RED first: a fixture plan whose task commits carry conventional messages WITHOUT the slug
  currently derives zero commits; after the fix the chosen mechanism either finds them or
  reports the miss loudly with a non-scoring outcome for the diff dimension.
- CONTROL: a plan whose commits DO mention the slug keeps deriving exactly the same set
  (byte-identical commit list) — the existing behaviour must not regress.
- CONTROL: a genuinely commit-less plan (nothing implemented) still reports no commits, and
  that state is distinguishable in the output from the convention-mismatch state.


## Proxy / Silence / Opt-in — ADR three-question review (2026-08-01, agent:main-orchestrator)

Answered per `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` BEFORE
implementation. This task is the ADR's canonical Question-2 case.

**Q1 Proxy — all three candidates above are proxies to different degrees; the ranking is
hereby fixed.**
Candidate 2 (derive from `extra.file_anchors`, or from the claim's recorded branch) trades the
commit-message convention for the ANCHOR-DECLARATION convention. Concrete input satisfying it
while violating the property: a task that implements files it never declared as anchors — the
same blindness `noAnchorOverlap` has, no stronger than what it replaces. **Candidate 2 is
rejected as a lateral move.** Candidate 3 (`lore done` records the commit sha set) IS the
property, not a proxy — but only for tasks archived after it lands. Candidate 1 (make the miss
loud) does not depend on either and removes the HARM rather than the miss.
**Decision: candidate 1 is MANDATORY and ships first; candidate 3 is the correct producer-side
property and follows; candidate 2 is not implemented.**

**Q2 Silence — this is the primary deliverable, not a side condition.**
Today `no commits derived` flows into `diff_available=false`, then into `based_on="absence"`,
then out as a published `major` finding against the WORK — a true statement about the BUNDLE
laundered into a defect claim about the code. Required:
1. An empty derivation for a plan whose tasks are ALL ARCHIVED is a CONTRADICTION (archived
   tasks have merged work by definition) and must be reported as `unverifiable`, never as
   absence.
2. Absence-based scoring of `scope_fidelity` is FORBIDDEN in that state — the dimension is not
   scored at all, and the report says so in those words.
3. The convention-mismatch state and the genuinely-commit-less state must be DISTINCT values.
   One shared empty is precisely the "empty result and clean result are the same value" failure
   the ADR names.

**Q3 Opt-in — clean.** Derivation runs on every `lore assess` call; there is nothing to opt into.

**Back-catalogue (the Required section above demands this be stated).** Every task archived
before candidate 3 lands carries no stored sha set, so candidate 1's `unverifiable` outcome is
the PERMANENT answer for those plans. That is correct and must NOT be back-filled by re-grepping
with a looser pattern: a re-grep would reinstate the message convention as truth, which is the
defect. An `unverifiable` historical record is auditable; a synthesized commit set is
afterwards indistinguishable from a real one.
