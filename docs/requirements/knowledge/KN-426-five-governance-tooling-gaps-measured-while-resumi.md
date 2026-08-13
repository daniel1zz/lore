---
id: KN-426
type: knowledge
role: knowledge
title: "Five governance-tooling gaps measured while resuming handoff-90: a dispatch gate that cannot resume a worktree, an unreachable unfiltered-anchor requirement, a scoped oracle that rebuilds a shared binary, an AC ceiling that squeezes out rationale, and a judge verdict on a truncated spec"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
links:
  - {id: KN-170, type: relates-to}
---
# Overview

Six governance-tooling gaps measured on 2026-08-11 while resuming
`knowledge-handoff-agent-main-orchestrator-90`. Each is logged because **an EXTRA ACTION was required to
work around it** — the workaround itself is the trigger, per the standing rule that doing extra work to
satisfy or bypass a gate IS the signal that gate has a hole. Five are new; **one is a fresh measured
instance of `GAP-1`, which is recorded as half-closed and is not** (its content half is still open, and
this is the second independent way it bites).

⛔ None of these was found by auditing. Each surfaced as friction while doing something else, which is
why the trigger has to be the workaround rather than a later review pass.

## GAP-20 (NEW) — the dispatch isolation gate cannot express "resume the uncommitted work in an EXISTING worktree"

**Measured.** Three worktrees from a killed session held real, unpushed work: two with ZERO commits and
all changes uncommitted (168 and 414 lines of implementation, no tests), one with 3 commits plus 5
uncommitted test-file repairs. Dispatching `lore-implementer` to continue inside those worktrees was
refused:

> `[DISPATCH_ISOLATION_GATE] Blocked: Agent with subagent_type="lore-implementer" and isolation=<absent>.`

The gate is RIGHT about the danger it names (an implementer in the shared checkout races every live
session). But `isolation: "worktree"` cuts a **NEW** worktree from the current `HEAD`, which is precisely
what a resume must not do — the work to be finished lives in a different, already-existing worktree, and
the gate offers no way to say so.

**The workaround, and why it is the report rather than the fix.** The orchestrator committed each
worktree's uncommitted work to that worktree's own branch (PATH-SCOPED, excluding mirror pollution),
then dispatched fresh agents with `isolation: "worktree"` and instructed each to `git merge <old-branch>`
as its first act. That is sound and auditable — `git merge-tree --write-tree` confirmed all three merged
cleanly before dispatch — but it means **the orchestrator authored commits containing another agent's
code**, which the audit trail can only distinguish by prose in the commit message.

⛔ Note the asymmetry that makes this worse than it looks: `git merge --ff-only` (which the gate's own
error message prescribes for base correction) does NOT work here, because both sides carry independent
commits. An agent following the gate's advice literally would fail and might reach for
`git reset --hard`, which a different gate correctly blocks.

**Status**: `open`, no owning spec. A `resumeWorktree: <path>` option on the dispatch tool, gated on the
path being an existing linked worktree of this repo, would close it.

## GAP-21 (NEW MEASUREMENT OF `GAP-1`, which is therefore NOT closed) — `lore done`'s unfiltered-anchor requirement is structurally unreachable from a COMPOUND AC command

`GAP-1` recorded that `lore done`'s unfiltered-run requirement is unreachable from the AC set. Here is a
second, independent mechanism producing the same dead end, measured on `AC-MIS-6`:

- `AC-MIS-6`'s declared command is compound by necessity: `bun run typecheck && bun test <file> && echo …`
  — the criterion asserts a monorepo-wide typecheck AND a negative-control suite in one oracle, which is
  what makes it discriminating.
- `lore verify` therefore records an attested pass whose command is that compound string.
- `lore done` then refuses:
  > declares test-file anchor(s) with no attested UNFILTERED result:pass run: `…mirror-human-id-brand.bun.test.ts`
- ⛔ **No attested evidence can ever satisfy this gate for such an AC**, because `lore verify` runs the
  AC's declared command and the gate demands a command that runs the anchor file *alone*.

**The workaround**: `lore evidence … --capture` (a real run, `capture_source: runner`, but ⛔ NOT attested
— no `attestation` block, no exit code, pass/fail still filled in by the recorder). So the archival of an
otherwise fully-attested task rests on a self-report the gate itself prescribed.

⛔ This is the same shape as the standing lesson that a script-mode AC's "must be attested" and "tail must
contain a summary" are structurally incompatible for a silent oracle — a pair of individually reasonable
requirements whose conjunction is unsatisfiable. The fix is not more discipline; it is for `lore done` to
accept an attested COMPOUND command that provably contains an unfiltered invocation of the anchor file.

**Status**: `open`, no owning spec. And ⛔ `GAP-1` must stay `half-closed` — this is its content half
biting a second way, not a new gap that supersedes it.

## GAP-22 (NEW) — `test:changed` in executing mode auto-triggers a build, so a concurrent worktree cannot run its own scoped oracle

**Measured by an implementer, reported unprompted.** `scripts/changed-tests.ts:976-979` triggers
`bun run build` whenever the selection includes ≥1 compiled binary-consumer test. Changing
`packages/lore/src/adapters/cli/commands/verify.ts` invalidates ~77 such tests, so the repo's own
prescribed worktree oracle (`bun run test:changed <base>`) would have rebuilt `dist/lore` — the target of
the global `lore` symlink that every concurrently-running agent depends on.

⛔ The two rules collide head-on: "worktree agents run `test:changed`, never the full suite" and "never
rebuild while an agent runs". Under concurrency, obeying both is impossible.

**The workaround**: `--list` for information only, then running the specific non-binary-consumer suites
by hand. That is strictly weaker than the tool — hand-picked suites are exactly the "only the anchor
files" under-selection `test:changed` exists to prevent — and it leaves the ~77 binary-consumer tests
unvalidated until an orchestrator runs them post-merge WITH a build.

**Status**: `open`, no owning spec. A `--no-build` flag that FAILS LOUD on selecting a binary-consumer
test (rather than silently skipping it) would let a worktree agent see exactly what it cannot verify.

## GAP-23 (NEW, minor but it shaped this session's output) — `lore ac set --statement` has a 2000-character ceiling, and pinning a clause costs characters

Measured five times in one session: `Validation failed on field 'acceptance_criteria.N.statement': String
must contain at most 2000 character(s)`. Every occurrence followed the same cause — a review round asked
for a clause to be pinned (an exact exit code, an expected set, a minimum fragment length, a named
resolver), and the pinned version is longer than the vague one.

⛔ The perverse incentive is the finding, not the limit: the cheapest way to fit is to delete the
*rationale* for an assertion while keeping the assertion, which is exactly the text that stops a future
reader from "simplifying" a discriminating oracle back into a vacuous one. Each of the five times, the
rationale is what got compressed.

**Status**: `open`, no owning spec. Either raise the ceiling for `script`-mode statements or split
statement into `assertion` + `rationale` with only the former bounded.

## GAP-24 (NEW) — `lore review` gives a verdict on a TRUNCATED spec and says so, but the verdict still counts

**Measured.** A review of `spec-governance-defaults-must-ship-and-every-recorded-gap-must` reported:

> Four of seven sections (Scope, Out of Scope, Acceptance Criteria, Sequencing Risks) are not visible to
> this review per the Truncation Notice … D5's forward reference to 'per Out of Scope, GAP-11' could not
> be verified against the Out of Scope text.

The reviewer was scrupulous — it labelled the silence and based no finding on it. But the emitted
`Decision: approve` is recorded with the same weight as one taken over the whole document, and a
`prd-sync`-style consumer cannot tell the difference. In this session the gap was material: a
spec/AC inconsistency (`GAP-17` missing from the Out of Scope list while `AC-GD-3(f)` pinned it as a
set member) sat in one of the invisible sections and was caught only because a LATER round happened to
receive the ACs separately.

⛔ The related standing lesson is that a human render is a lossy projection; this is the same defect on the
JUDGE's input side, which is worse — a lossy render misleads a reader who can go re-read the source, while
a truncated judge prompt produces a verdict nobody can tell is partial.

**Status**: `open`, no owning spec. The verdict payload should carry a machine-readable
`input_completeness` field, and `lore approve` should refuse (or loudly warn) on a verdict whose input was
truncated.

## GAP-25 (NEW, and the most consequential of the six) — `mirror:export` does not update an EXISTING file's content, and no check compares content

**Measured 2026-08-11 with a before/after hash, on `main`, twice.** The gap ledger doc was renamed in the
corpus (`G<n>` → `GAP-<n>`, corpus v37 then v39). Then:

```
before md5: dfceb97235d3e373bcd2ad8aff36ad4b
bun run mirror:export   → exit 0, every type reported OK
after  md5: dfceb97235d3e373bcd2ad8aff36ad4b   ← IDENTICAL
```

The mirror file still carried **16** `## G<n>` headings and **0** `## GAP-<n>`, with no
`legacy-gap-aliases` fence — i.e. the entire rename was invisible in the mirror while the exporter
reported success. The same run DID create a brand-new file (`TASK-666-*.md`), so the exporter writes NEW
docs and silently skips CONTENT updates to existing ones.

⛔ **And nothing catches it, by design-as-stated**: `mirror:export`'s own success line says
*"count and slug parity; **file CONTENT is not compared**"*, and `check:spec-mirror` is the same
`runCheck`. So the corpus↔mirror pair has an existence oracle and NO content oracle.

**Scale, sampled from docs this session edited:**

| mirror file | expected new content | present? |
|---|---|---|
| `SPEC-137-*` (S3 spec) | `D6` / `D4d` | **NO** |
| `PLAN-122-*` (S4 plan) | `D4a` | **NO** |
| `SPEC-138-*` (S4 spec) | `D4a` | yes |
| `SPEC-138-*` (S4 spec) | `REVISION RECORD` (round 5) | **NO** |

`SPEC-138` is the tell: it holds content from an intermediate state and not the final one. Its `D4a` text
arrived only because a WORKTREE agent happened to run `mirror:export` at a moment when `D4a` existed — the
documented anti-pattern — and that snapshot was then merged. ⛔ So the only path by which mirror content
ever became current is the one path the rules forbid, and the sanctioned path (export from `main`) is a
content no-op.

⛔ This is the exact standing lesson *"SSOT↔installed asset pairs need content-parity assertions; manifest
presence proves nothing"*, now measured on the corpus↔mirror pair — the pair whose whole purpose is to be
the human-readable projection of the SSOT. A reader who greps `docs/requirements/` today can read a spec
decision that was superseded hours ago and see nothing wrong.

⛔ It also invalidates a claim made earlier in this same session: an orchestrator report stated the mirror
had been "re-exported and committed on `main`". The export ran and exited 0; the CONTENT did not sync. That
report was wrong, and it was wrong because it trusted the exporter's OK line — which is precisely the
failure mode this entry describes.

**Status**: `open`, no owning spec. Two things are needed and they are separable: (1) `exportDocs` must
rewrite an existing file whose rendered content differs from the corpus; (2) `runCheck` must gain a
content-hash comparison, so a stale mirror is a RED and not a silent pass. ⛔ Do not fix only (1) — without
(2) the next skip is invisible again.

## Scope

All six entries are `open` with no owning spec. `GAP-20`, `GAP-22`, `GAP-23`, `GAP-24`, `GAP-25` are new;
`GAP-21` is a second measured mechanism for `GAP-1`'s open content half and ⛔ does not supersede it.

⛔ These ids continue the `GAP-<n>` namespace established in
`knowledge-attestation-is-structurally-one-sided-lore-verify-can` on 2026-08-11 (ids `GAP-1`…`GAP-19`
there). ⛔ `GAP-25` is the one to fix FIRST — it is the reason a reader cannot trust `docs/requirements/` at all. They are NOT yet mirrored into that ledger's structured entries, so the unowned-gap report
`AC-GD-3(f)` pins at exactly eight members does NOT count them — ⛔ whoever folds these in must update
that AC's pinned set in the same change, or set equality reddens.
