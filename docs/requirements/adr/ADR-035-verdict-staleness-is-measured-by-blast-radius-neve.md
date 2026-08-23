---
id: ADR-035
type: adr
role: decision
title: "Verdict staleness is measured by blast radius, never by git ancestry — a peer merge preserves ancestry while invalidating the verdict"
status: approved
priority: high
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PRD-001
links:
  - {id: PLAN-137, type: informs}
---
**Status**: proposed
**Date**: 2026-08-17

## Context

A verdict must be invalidated when the state it describes moves. The obvious test — "is the recorded HEAD still an ancestor of the current branch?" — is wrong, and it is wrong in the specific direction that makes it useless: it reads **green** through the failure it is supposed to catch.

Measured 2026-08-17 in the session that produced this ADR: a full test-suite verdict was reached on a clean tree at commit `08091dfd`. While it was being read, a concurrent session merged 1871 lines and `main` became `7ab1d742`. The verdict's log still said green, `git status` still said clean, and **`08091dfd` was still an ancestor of `7ab1d742`** — a merge preserves ancestry by construction. Ancestry therefore detects only history *rewrites* (rebase, reset, amend); it cannot detect the far more common concurrent event: someone landed code underneath you.

The same session produced the mirror-image incident: an orchestrator's corpus write reddened 9 tests in a subagent's worktree, and the subagent reproduced those failures at the merge-base and classified them "pre-existing". Its method was sound; its conclusion was wrong, because the base checkout shares the same live database. "Reproduces at BASE" proves only "not caused by my diff", which is strictly weaker than "pre-existing".

## Decision

Staleness is measured by **blast radius**, not ancestry:

```
git diff --quiet <recorded_tree_digest> HEAD -- <paths the oracle depends on>
```

three-valued, following the existing `BranchMeasurement` discipline — `unmeasured` is not `changed`, and an unmeasurable answer never silently becomes a clean one.

Corollaries that follow from the same reasoning:

- The state identity is a **pair**, not a single value: `{ tree_digest, corpus_rev }`. Code state and corpus state move independently, and the second incident above was a *corpus* move with no code change at all. A git sha alone would have said nothing about it.
- `corpus_rev` is sourced from `MAX(audit.id)` — already an `INTEGER PRIMARY KEY AUTOINCREMENT` (measured at 6176), read by a rightmost B-tree descent in microseconds with no process spawn.
- `git` calls cost ~10.9ms per spawn (measured, 20 iterations). Affordable once per attestation; ruinous per evidence row — 200 rows would be 2.2s of pure fork. Therefore: **stamp once, compare scalars; gates never recompute.**

## Quality Attributes Affected

| Attribute | Impact | Scenario |
|---|---|---|
| Integrity | + | QA-1 / AC-CT-4 — catches the concurrent-merge case ancestry misses entirely |
| Performance | ~ | One `rev-parse` + one `MAX(audit.id)` per attestation; ancestry would have been marginally cheaper but measures the wrong thing |
| Modifiability | − | Each oracle must declare its blast radius; a wrong declaration silently narrows coverage |

## Alternatives Considered

| Option | Pros | Cons | Why rejected |
|---|---|---|---|
| `git merge-base --is-ancestor` | One cheap spawn; trivially explained | **Reads green through a peer merge**, the measured failure mode; only catches rebase/reset | Wrong invariant, not merely a weaker one |
| Whole-tree hash comparison | No blast radius to declare, so nothing to get wrong | Over-reports on every cosmetic peer commit anywhere in the repo | Acceptable into a *degrade* path but not into a block path; retained as the fallback when no radius is declared |
| Timestamp comparison (as `assessmentFreshness` uses) | Free, no spawn, matches existing precedent | A tree has no meaningful monotonic clock; `mtime` is rewritten by git and is unusable as identity | Cannot express code state |
| Corpus revision only (drop the git half) | Free; catches the corpus-write incident | Says nothing about code changes, which is the other half of what an oracle measures | Half the problem |

## Consequences

**Easier**: a verdict can now state precisely what it is a verdict *about*, which makes the subagent misattribution decidable rather than a judgement call. `unmeasured` gives an honest answer where a boolean would have had to guess.

**Harder**: every script-mode oracle now needs a declared blast radius, and an under-declared radius narrows coverage silently — the same shape as an under-declared file anchor. Over-reporting is accepted deliberately: this feeds a *degrade* path (see the `unbound`/`stale` ADR), where a false positive costs a re-run, not a blocked loop.

## Validation Plan

`AC-CT-4` is a discriminating PAIR and both halves are mandatory: a peer commit **inside** the radius must classify `stale`, and one **outside** it must stay `bound`. The declared falsifier is exactly the rejected alternative — replace the blast-radius diff with `merge-base --is-ancestor` and the command must exit 1. Note what that falsifier proves: under ancestry, half (b) still passes while half (a) breaks, so a test asserting only half (a) would have been satisfied by the wrong implementation.
