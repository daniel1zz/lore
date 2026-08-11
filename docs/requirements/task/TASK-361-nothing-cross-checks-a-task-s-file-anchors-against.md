---
id: TASK-361
type: task
role: plan
title: "Nothing cross-checks a task's file_anchors against the paths its own body names, so the anchor mutex is blind to a collision the task already documented"
status: draft
priority: high
created: 2026-08-06
updated: 2026-08-06
tags: [defect, anchor-mutex, gate-hole, dispatch, silent-omission]
parent: PRD-001
links:
  - {id: TASK-365, type: relates-to}
  - {id: TASK-359, type: relates-to}
---
# Defect — nothing cross-checks a task's `file_anchors` against the paths its OWN BODY names, so the anchor mutex is blind to a collision the task itself already documented

Measured 2026-08-06 on `main @ 074df1cd`, on two live `draft` tasks with no claim:

| task | declared `file_anchors` |
|---|---|
| `task-validity-landed-on-lore-list-only-the-dispatch-surface` (critical) | `flows/task-feed-flow.ts`, `cli/commands/status.ts`, `cli/commands/tree.ts`, `cli/commands/pending.ts`, **`cli/commands/get.ts`** |
| `task-the-shared-renderdocmarkdown-seam-still-drops-structured` (high) | `flows/feed-flow.ts`, `cli/commands/feed.ts`, `cli/commands/gate.ts`, `cli/get-render.ts` — **`cli/commands/get.ts` ABSENT** |

The declared sets are disjoint, so `noAnchorOverlap` would have admitted **both concurrent claims**.
They collide anyway: the seam task's own Oracle section, line 78 of its body, states

> **REGRESSION**: `lore get`'s notice is byte-identical to today (the seam fix must not
> double-announce once `get` stops appending its own)

— i.e. the task text itself says the implementer must edit `cli/commands/get.ts`. The information
needed to predict the collision was **already inside the corpus**, in the task doc, at authoring
time. Nothing read it.

Caught only because a human-in-the-loop orchestrator hand-read both bodies before dispatching.
That hand-read is the tell: an extra manual step taken to compensate for a gate is evidence the
gate has a hole, not evidence the operator was diligent.

⛔ This is NOT the residual the anchor advisory already names. That one is "an UNDECLARED anchor is
invisible to `noAnchorOverlap`" — a general statement that anchors are opt-in. This is sharper and
mechanically checkable: the declaration is contradicted **by the same document's own prose**, and
the contradiction is a string match away.

# Mechanism root — two representations of one fact, with no reconciliation

A task carries the set of files it will touch twice: once structurally (`extra.file_anchors`,
which the gate reads) and once in prose (the body, which the implementer reads). Nothing compares
them. The structural copy is authoritative for the mutex and the prose copy is authoritative for
the work, so the mutex is protecting a set that can be a strict subset of what gets edited — and
the gap is silent at claim time, surfacing as a merge conflict or, worse, as two agents editing
one file with the last merge winning.

The just-merged `anchor-resolution` advisory does not help: it verifies each declared anchor
RESOLVES, never that the declaration is COMPLETE. Its own control branch confirmed this during the
measurement — all five anchors resolved, no advisory, declaration still wrong until hand-fixed.

# Required fix

1. **A deterministic completeness advisory at task-create and at claim time**: scan the task's
   `content` for repo-relative POSIX paths under the declared source roots (the same universe
   `test:changed` uses: `packages/**`, `scripts**`), and report every path the body names that
   `extra.file_anchors` does not contain. Non-blocking at create (the body legitimately cites
   files as CONTEXT, not as edit targets); surfaced loudly at claim, where the mutex decision is
   actually made.
2. ⛔ **Do NOT make it a refusal, and do NOT auto-add the missing anchors.** A task body cites
   paths for several reasons — the defect's location, a reference implementation, a regression pin
   to leave untouched. Auto-adding would widen the mutex to every file ever mentioned and make
   concurrency impossible; refusing would block on prose the author deliberately wrote as context.
   The property is "the author considered this path and decided", and the advisory's job is to
   force that decision to be conscious.
3. **Surface it where the DISPATCHER reads, not only where the author reads.** The author sees the
   create-time output once; the party the mutex protects is whoever schedules concurrent work
   later. Carry the same computation in `lore ready --json` beside `anchor_conflicts[]` and
   `anchor_resolution` — this is the identical asymmetry the anchor-resolution task named, and the
   identical remedy.
4. **SWEEP — part of scope**: run the check over every open task and report how many carry a
   body-named path absent from their anchors. That count is the measure of how long this has been
   silently true. ⛔ Do not assume the two tasks above are the only instances.

# Named limitation of the proposed check, measured while filing this very task

The path-scan in Required #1 **would not have caught the second instance found the same hour.**
`task-validity-landed-on-lore-list-only-the-dispatch-surface` (critical) declared five anchors
while its Required #6 reads:

> `--governed-by`: `CorpusService.listGovernedBy` must return full records (or carry validity) so
> the same gate applies. This is the one item requiring a service-layer signature change.

That names a **SYMBOL**, not a path. `packages/lore/src/service/corpus-service.ts` appears nowhere
in the body, so a repo-relative-path regex finds nothing, while the task unambiguously commits to
editing that file. A grep over the body for path-shaped tokens returned only
`validity-service.ts` — a file the task consumes read-only and deliberately does NOT declare.

So the check has **two distinct blind spots, in opposite directions**:

- **Symbol → file** (`CorpusService.listGovernedBy` → `service/corpus-service.ts`): invisible to a
  path scan. Resolving it requires a symbol index — the LSP/serena tier, not a regex. State
  explicitly whether this task closes it or names it as residual; ⛔ do not silently ship a check
  that appears to cover "paths the body names" while missing the commonest way an implementer
  actually refers to a service.
- **Path cited as CONTEXT, not as an edit target** (`validity-service.ts` above;
  `task-feed-flow.ts` cited by the seam task purely for a report-only sweep): the scan WILL flag
  these, and flagging them is correct only because the advisory's job is to force a conscious
  decision — it is NOT correct to auto-add them. This is why Required #2 forbids auto-adding.

⛔ Do not resolve the first blind spot by widening the regex to bare identifiers. `CorpusService`,
`DocRecord`, and `StoreInterface` appear in nearly every task body; a matcher keyed on them would
flag everything and be ignored within a day — the failure mode this repo has already measured for
advisories nobody is obligated to act on.

# Oracle

- A task whose body names `packages/lore/src/adapters/cli/commands/get.ts` while its
  `file_anchors` omit it produces an advisory naming that exact path, AND exits 0, AND the task is
  still created/claimed — asserting the advisory alone would pass against an implementation that
  refused.
- **CONTROL**: a task whose body names only paths it already declares produces NO advisory. Verify
  on `task-the-shared-renderdocmarkdown-seam-still-drops-structured` as it stands NOW (anchor added
  2026-08-06, declaration complete) — a blanket-advisory regression cannot pass as green.
- **BOUNDARY**: a path inside a fenced code block, a path with a `#Symbol` suffix, a path that does
  not resolve on disk, and a bare filename with no directory — state the decision for each rather
  than letting the regex decide silently.
- `lore ready <plan> --json` carries the finding, and distinguishes *not scanned* from *nothing
  found* — an empty array and an absent scan must not be the same value (the discriminated-union
  shape `anchor_resolution` already ships).
- REGRESSION: `noAnchorOverlap`'s admit/deny behaviour is UNCHANGED — this task adds a signal, it
  does not move the mutex. Assert the same claim pairs are admitted and denied as before.
- `bun run typecheck` clean; `bun run test:changed <base>` with a NON-ZERO selection.
- Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "The two tasks' declared anchors are disjoint" is a proxy for "these two tasks can run
concurrently". Concrete input satisfying the proxy while violating the property: the exact pair
measured above, both live and unclaimed on `074df1cd`. The fix does not remove the proxy — anchors
stay opt-in — but it makes the strongest available contradiction observable.

**Silence.** Total at claim time, and the information was already in the corpus. A gate that had
the data and did not read it is worse than one that lacked it.

**Opt-in.** Anchors remain opt-in and this advisory only constrains authors who wrote a body. ⛔ Do
not claim this closes the anchor-mutex hole; a task that names no paths in prose and declares none
is still invisible, and manual intersection queueing stays necessary as defense-in-depth.
