---
id: KN-460
type: knowledge
role: knowledge
title: "A concurrent write silently invalidates the other party's verdict: the orchestrator polluted its own implementer's corpus-reading tests, and a peer merge staled a full-suite green"
status: approved
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PRD-001
---
Two measurements from one session, both instances of the same defect: **in a shared
checkout, a concurrent write silently invalidates the other party's verdict, and the
victim has no signal that it happened.** One direction was already known (a subagent
cannot tell the orchestrator's writes from pre-existing drift); this session measured
the ORCHESTRATOR as the polluter, and then measured a second, structurally identical
case in git rather than the corpus.

## A. The orchestrator is the polluter, and it exempted itself

The dispatch bundle for `task-the-mirror-prune-does-not-retire-a-mapping-whose-doc-was`
forbade the implementer, in bold, from writing the repo's real corpus — the standing
`.lore/` pollution rule. **The orchestrator then wrote the real corpus while that
implementer was running**, creating `knowledge-an-ac-id-is-spec-local-but-every-prose-
reference` (KN-458) mid-flight.

Consequence, measured: this repo's `scripts/tests/spec-mirror-export.test.ts` reads the
REAL live corpus by design (its own header says so). The implementer's worktree was
branched BEFORE that commit, so it saw a corpus holding 458 knowledge docs against 457
mirror files on disk. **Nine tests failed.**

The implementer then did exactly the right thing — it reproduced the nine at the
merge-base in a scratch worktree, got the identical nine test names, and classified them
`9 pre-existing / 0 regressions`. Its verdict on ITS OWN diff was correct. Its ATTRIBUTION
was wrong, and could not have been right: the BASE checkout shares the same live DB, so
the orchestrator's concurrent write reproduces there too. **"Reproduces at BASE" is
therefore NOT evidence of pre-existing — it is evidence of "not caused by this diff",
which is a strictly weaker claim.**

Decisive control, run on main after merge: `bunx vitest run
scripts/tests/spec-mirror-export.test.ts` → **23/23 pass, exit 0**, because main by then
carried the mirror file. The nine were orchestrator-caused, and they evaporated without
anyone fixing anything.

## B. The same shape, one layer down: a peer merge invalidates a full-suite verdict

Later the same session, a full `bun run test` was run to closure on a clean tree:
vitest 512 files / 8994 pass, bun 2141 pass / 0 fail across 212 files (869s),
check:spec-mirror OK, persisted exit code 0. Named commit: `08091dfd`.

While that suite was running, a CONCURRENT SESSION merged 1871 lines into `main`
(`7ab1d742`, an anchor-coverage ratchet + its ledger). By the time the verdict was read,
the tree it described no longer existed. Nothing announced this. The suite log still says
green; `git status` still says clean; only `git log` shows the verdict is stale.

That merge armed a RATCHET, which makes it the exact case the standing lesson already
covers ("a threshold armed by one agent is calibrated against ITS base — a concurrent
peer merge invalidates it"). What is new is that the same event also invalidated an
unrelated full-suite verdict, which no lesson covered.

## The common root

Both are: **a verdict is a claim about a tree state, but the tree state is shared and
mutable, and no verdict artifact records which state it describes.** The suite log has no
commit sha in it. The evidence row has no tree hash. The test failure output names no
corpus revision. So a stale verdict and a live one are byte-identical — the same
"renders identically whether or not it is sound" shape that recurs throughout this corpus.

## Mechanization directions

⛔ Prose telling agents "do not write the corpus during a dispatch" is the wrong layer:
this session's orchestrator WROTE that prose into its own bundle and then violated it,
which is proof the prose layer does not bind.

1. **Stamp verdicts with the state they describe.** `lore evidence` / `lore verify`
   already capture a command and a tail; they should also capture `git rev-parse HEAD`
   and a corpus revision counter, and `lore done` should refuse — or at minimum flag — an
   attested pass whose recorded HEAD is no longer an ancestor of the current branch. This
   turns "stale verdict" from invisible into decidable.
2. **A dispatch-scoped corpus write lease.** While any task on a plan is claimed, an
   orchestrator corpus write either blocks, or is recorded and surfaced to the returning
   implementer as "these N docs changed under you". The implementer's triage then starts
   from fact instead of inference.
3. **Give the real-corpus-reading tests a pinned snapshot** (export the live corpus to a
   temp DB at suite start), so that a mid-run corpus write cannot color a test result at
   all. This is the only option that removes the coupling rather than reporting it.

Option 1 is the cheapest and generalizes past this incident; option 3 is the only one that
makes case A structurally impossible.

## What NOT to conclude

⛔ Do not conclude the implementer erred. Its method was sound and its diff-level verdict
was right; the misattribution was forced by the environment. Blaming the executing agent
here is the "attribute a design gap to the execution layer" error, and it would leave the
mechanism untouched.
