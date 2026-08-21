---
id: KN-493
type: knowledge
role: knowledge
title: "A repo-wide oracle cannot have hand-enumerated file anchors, and four more orchestration-layer errors measured in one session"
status: approved
priority: high
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PRD-001
links:
  - {id: SPEC-134, type: relates-to}
  - {id: KN-486, type: relates-to}
---
Five errors and gaps in the ORCHESTRATION layer, measured 2026-08-21 while landing four work
items from `knowledge-handoff-agent-main-orchestrator-109`. None is an implementer failure; four
are the dispatching agent's own, which is why they are recorded together.

## F1 — when an AC's oracle is a repo-wide scan, the task's file anchors CANNOT be hand-enumerated

`AC-BFI-14` asserted "exactly one construction site of the anchored predicate, over `packages/**`
and `scripts/**`", and its statement listed the copies it believed existed. The list was WRONG:
it counted the test witness as one of three production copies while missing a real third,
`collectCodeAnchorSpecMembers` at `packages/lore/src/adapters/cli/commands/status.ts:708-709`
(confirmed pre-merge via `git show 7699bf6d:`). True population: three production sites plus the
witness.

The AC survived, because its own text says an enumerated list "cannot observe that and is
explicitly NOT the oracle" — the scan found what the prose missed. **The TASK did not survive**:
its `file_anchors` were derived from the same wrong list, so `status.ts` was never anchored. The
implementer therefore had to choose between editing an unanchored file and failing an AC it could
not otherwise satisfy. It fixed and flagged, which was right.

⇒ The general rule: a repo-wide oracle's anchor universe is UNKNOWN until the scan runs. Either
anchor the scan's whole universe (usually impractical), or state in the bundle that the anchor set
is provisional and extending it is expected and must be reported. ⛔ Deriving anchors from a
hand-written enumeration reproduces the enumeration's errors as a mutex the implementer cannot
satisfy.

## F2 — no surface answers "who holds this FILE right now, corpus-wide"

F1's collision was with `task-land-the-adopted-resolution-state-its-required-owner`, live in a
DIFFERENT plan, which declared `status.ts` as an anchor. Measured while it was claimed:

- `lore ready <own plan> --json` → `anchor_conflicts: null`, `sessions: null`. Plan-scoped, so a
  cross-plan holder is invisible.
- `lore bootstrap --json` → `active_sessions` DOES list the other agent and its `task_slugs`
  corpus-wide, but carries no anchors. Answering "does anyone hold this path" needs a per-task
  `file_anchors` fetch for every claimed task.

So an agent about to touch a file outside its own anchors has no single query available. The
`task-claim` gate is the real mutex and it is corpus-wide — but it can only see DECLARED anchors,
so F1's undeclared file was invisible to it too.

## F3 — a false standing instruction survived five dispatch bundles

Every bundle carried: *"`packages/core` is a monorepo sub-package: build it before typechecking any
`packages/lore` consumer, or the red you read is an artifact."* Measured 2026-08-21:

    packages/core/package.json    → scripts: none,  exports: {".": "./src/index.ts", "./node": "./src/node.ts"}
    packages/lore/package.json    → scripts: none
    packages/dashboard/package.json → build: vite build   (a web bundle, not a consumed library)
    root package.json             → build: bun run scripts/build.ts   (compiles dist/lore)

⇒ **No TypeScript sub-package in this repo has a build step.** `@lore/core`'s exports resolve
straight to `.ts`, consumed as-is by both `tsc` and Bun, so a new export is visible to
`packages/lore` immediately. The instruction is a correct GLOBAL rule (`~/.claude/CLAUDE.md`,
worktree concurrency) applied to a repo it does not fit. `dist/lore` is the only artifact that
goes stale, and its discipline is already covered by binary provenance.

⛔ An implementer caught it and said so in its report. The dispatcher had repeated it four more
times by then. Confidently-wrong context is not free: it spends the reader's attention on a step
that does not exist.

## F4 — the root CLAUDE.md is at its eviction floor, and this session spent the remainder

`lore status --check-claude-md` measured 23753/24576 bytes after one standing-lesson line was
added this session. The eviction floor is 0.97 × 24576 = 23839, so **86 bytes remain before any
addition BREACHES** — verified by adding a 5-line note and getting exit 3: *"at or past the
eviction floor — evict a block to the corpus and leave a one-line pointer before adding."* The
note was reverted rather than paid for with an eviction it did not deserve.

⇒ The next standing lesson worth adding must be paired with an eviction. ⛔ The gate explicitly
forbids the three cheap outs: recording the displaced fact in another module's doc, trading lines
for bytes, and raising the ceiling.

## F5 — `--description` values beginning with `--` are parsed as flags

`lore report-issue --description "--falsify is the corpus's ONLY mechanism…"` exited 2 with
`Error: Unknown option: --falsify is the corpus's ONLY mechanism…` — citty consumed the value as a
flag name. Worked around by rewording. Minor, but it fails on the exact content most likely to be
filed: a report about a flag usually starts by naming it.

## What these have in common

F1, F3 and F4 are all the dispatcher stating something with confidence that a five-second command
would have contradicted — an enumeration, a build step, a byte budget. F2 is the missing command
that would have made F1 detectable. ⛔ The mitigation is not more diligence: it is that a bundle's
factual claims about the tree (which files, which build steps, which counts) should be GENERATED
by the commands that measure them, at dispatch time, rather than typed from memory.
