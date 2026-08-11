---
id: TASK-412
type: task
role: plan
title: "lore handoff reports Modified Files (none) while four dispatched worktrees hold uncommitted work — the ticket is authored mid-flight and records nothing about the flight"
status: draft
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: ADR-028, type: relates-to}
  - {id: TASK-399, type: relates-to}
---
Discovered while consuming `knowledge-handoff-agent-main-orchestrator-69`. Reviewed through
`adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the` before filing.

⛔ **This document was corrected once, at v2, by its own author.** The v1 filing argued the
in-flight agents were ORPHANS whose work would be lost to routine cleanup. That was measured to
be FALSE minutes later — a live concurrent orchestrator committed and merged them correctly. The
corrected defect is narrower and different in kind, and the false version is preserved here
because the correction is itself the evidence for Q2 below: a snapshot of concurrent state, taken
honestly and written down, was wrong within four minutes.

## Measured 2026-08-01 (all timestamps local, UTC+8)

`knowledge-handoff-agent-main-orchestrator-69` printed:

    ## Modified Files
    (none)
    ## Task Refs
    (none)
    ## Plan
    (none)

Timeline, from filesystem `stat`, `git log`, and corpus timestamps:

| time | event |
|---|---|
| 21:19:51 – 21:21:02 | four agent worktrees CREATED by a concurrent orchestrator session |
| 21:27:02 | handoff 69 written (`Modified Files: (none)`), its agents still running |
| 21:30 – 21:38 | agents still writing (`agent-adcccee`'s test file: 7s before measurement) |
| ~21:38 – 21:41 | the concurrent session COMMITS and MERGES two of them correctly |

`main` HEAD moved UNDER the resuming session's feet during its own turn:

    63c3537  (HEAD when this session started)
    9053a9b  fix(evidence): refuse a self-reported pass whose command mixes runners
    f5dc8d7  merge: lore evidence refuses a mixed-runner --command
    f8ad01a  fix(ai): name the omitted section headings in the review judge's truncation notice
    955c26d  merge: truncation notice names the omitted section headings   (HEAD four minutes later)

Verified: `git merge-base --is-ancestor 9053a9b HEAD` → true; `extractSectionHeadings` now
present in `main`'s `review-template.ts` (9 hits, was 0).

**So no work was lost, and the concurrent session's dispatch discipline was correct** — commit
before stop, `merge --no-ff`, conventional messages. The v1 claim of an orphan-and-destroy path
is withdrawn.

## What the actual defect is

The resuming session was structurally blind to a live sibling session. From `(none)` plus a
bootstrap payload reporting `active_sessions: []` and `my_claims: []`, it concluded — and briefly
wrote into seven corpus documents — that four worktrees were abandoned residue. It then had to
retract that. Two concrete near-misses in one turn:

1. It came within one command of `git worktree remove` on worktrees an active session owned
   (averted only by the standing CLAUDE.md rule to check `git log` on the branch first).
2. It wrote "blocked, do not dispatch" advisories into seven task docs naming files that were
   merged into `main` before the advisories were four minutes old.

**Second-order finding, and the more serious half:** the concurrent session resolves to the SAME
actor as the resuming one — `agent:main-orchestrator`, the identity CLAUDE.md itself prescribes
for main-checkout oracle runs. Two live orchestrators therefore share one actor, which is exactly
the condition under which SPEC-042's derived sessions collapse and `noAnchorOverlap` cannot fire
("all falling to the same OS username → the gate never fires", generalized: any shared actor
string). `active_sessions: []` in the bootstrap payload is consistent with that collapse, not
with an idle corpus. Whether this warrants its own filing is left to the reader of this task;
it is recorded here because it was measured here.

## Proxy / Silence / Opt-in — ADR three-question review

**Q1 Proxy — `modified_files` is a proxy for "state this thread leaves behind", and the
concurrent/in-flight population is precisely what it cannot see.**
Concrete input satisfying the proxy while violating the property — the measured case: the
orchestrator's own checkout was clean because it DISPATCHED rather than edited, so an honest
`(none)` coexists with four worktrees of live work and a `main` that is about to move. No bad
intent anywhere; the field is answering a different question than the reader asks of it.
The property is enumerable, just not from the author's memory: `git worktree list`, plus
per-worktree `status --porcelain` and `log <base>..<branch>`, plus the repo's HEAD sha at write
time. **Decision: `lore handoff` must COMPUTE this, not ask for it** — and it must record the
HEAD SHA, which is what lets a consumer detect that the base moved rather than guess.

**Q2 Silence — `(none)` for an unenumerated field is the canonical failure, and this task's own
v1 error is the proof.**
"No modified files" and "modified files were never enumerated" print identically. Worse, a
consumer who compensates by measuring concurrent state HIMSELF gets a snapshot that expires:
this document's v1 was measured carefully and was wrong within four minutes, because
`--porcelain` and `ahead-count` are not stable facts. Required:
- the computed section distinguishes (i) no worktrees, (ii) worktrees all clean-and-merged,
  (iii) worktrees with uncommitted or unmerged work — naming path, dirty count, ahead count;
- it records the HEAD sha at write time as a first-class field;
- ⛔ every line of it is stamped as OF THAT INSTANT, with the re-measure command printed next to
  it. A handoff must never present concurrent state as a durable fact — the consumer's correct
  action is always to re-measure, and the ticket's job is to tell it to, not to answer for it.

**Q3 Opt-in — computing it must be unconditional.**
An `--include-worktrees` flag reproduces the defect for whoever forgets it, and the population
that would remember already checks by hand. Runs always. Outside a git repo, emit the explicit
not-a-repo marker, never a bare `(none)`.

## Required

- `lore handoff` computes the in-flight-worktree section + HEAD sha unconditionally, with the
  three states distinguished and every line instant-stamped.
- State (iii) also prints to stderr at write time: the author is the last party who still knows
  what those agents were doing, and they are about to stop.
- Scope: REPORTING only. It must not block the write, and must not merge, commit, or clean
  anything — a handoff that refuses to be written strands the thread, which is worse.
- Distribution: binary-side (`lore handoff`), so a fresh `lore init` + `lore setup` gets it. No
  `assets/` surface involved.

## Oracle

- RED first: a fixture repo with one worktree holding an uncommitted change and an empty branch,
  where `lore handoff` today emits `Modified Files: (none)` and no worktree section; after the fix
  it emits state (iii) naming that path. Must fail before the fix.
- RED first: the written ticket contains the HEAD sha at write time. Assert the sha VALUE against
  `git rev-parse HEAD`, not merely that a sha-shaped string is present.
- CONTROL: no extra worktrees → state (i), distinguishable from (ii). Assert the value.
- CONTROL: all worktrees clean AND merged → state (ii).
- CONTROL: corpus outside a git repo → not-a-repo marker, and the handoff still WRITES (exit 0).
- CONTROL: the writer-identity guard and every existing field stay byte-identical — in particular
  the resume ticket's `KD<n>`/`NS<n>` ordinals and cardinality line, which the Stop-time coverage
  check consumes.
- Fixture repos are throwaway (`mkdtemp`), never this repo or its `.lore/`.
