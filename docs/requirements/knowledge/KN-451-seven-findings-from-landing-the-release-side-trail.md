---
id: KN-451
type: knowledge
role: knowledge
title: "Seven findings from landing the release-side trailer unbind: a body-only mirror detector, a test that required the defect to persist, and an assess that scored MAJORs against files it called unverifiable"
status: approved
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
---
Session 2026-08-13, agent:main-orchestrator, resuming
`knowledge-handoff-agent-main-orchestrator-101`. Seven findings, each with the
measurement that produced it. The first three are one mechanism seen from three
sides; the last two are about the judging surfaces themselves.

## 1. The mirror drift detector is body-only, so `--force` cannot repair a status drift

`ExportDocsService` compares `canonicaliseBody(extractBodyFromMd(fileMd))` against
`canonicaliseBody(resolvedBody)` — body only. Its own comment at
`export-docs-service.ts:499` states the check is "blind to frontmatter by design".
Frontmatter is regenerated only via three IDENTITY signals (reconciled mapping,
on-disk `id:` mismatch, stale refs); a status transition trips none.

Because `--force` overwrites only files the body-only detector already flagged,
`lore export-docs --force` cannot fix a status-only drift either. Measured: after
SPEC-142 went draft→approved and TASK-718 went draft→archived, BOTH exporters
reported clean (`1482 files already match corpus`, `drift 0` on all six types)
while both mirror files still read `status: draft`. `check:spec-mirror` compares
count and slug parity only — it says so in its own OK line.

⛔ The handoff's KD6 said "re-export and commit before the run CANNOT pre-clean a
content-changed doc". Sharper: no invocable command writes it AT ALL. Only the
suite does. `bun run test:bun` rewrote exactly the SPEC-142 line the routine
exporters had just refused, dirtying the tree mid-run and tripping
`assertRepoCorpusClean`. The documented remedy is not merely unreliable — the
tree MUST be dirtied by the suite once and that write committed.

Corollary worth its own check: `AC-OX-1` of
`spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check` asserts "No test
invokes the mirror exporter in WRITE mode anywhere under scripts/tests or
packages/lore/tests". That write happened anyway. Either the oracle does not
reach the path performing it, or the write comes from a surface the AC does not
enumerate — determine WHICH before fixing the exporter. An AC that is green while
the behaviour it forbids is observable is the more serious of the two defects.

## 2. A test can require the defect to persist — the third member of a known family

`check-gap-namespace.test.ts`'s AC-GD-3(d) direction 2 proved "the checker is
corpus-keyed, not mirror-keyed" by reading a REAL stale mirror file in this repo
and asserting it was stale. Force-exporting 31 drifted files — repairing them —
turned that assertion red at line 531. Nothing about the checker changed; the
repo just got less broken.

This repo had already named two members of this family, inside the very document
that test reads (`KN-170`): *a check that regenerates what it is checking cannot
fail*, and *a test that repairs the tree before asserting cannot fail either*.
The third is: A TEST THAT REQUIRES THE DEFECT TO PERSIST. Its distinctive harm is
directional — it applies pressure NOT to fix the defect, because fixing it
reddens the suite. The near-miss here was real: reverting the mirror repair was
the cheapest way to green.

One root for all three: THE ORACLE DOES NOT OWN BOTH ENDS OF THE COMPARISON IT
CLAIMS TO MAKE. Fixed by constructing both ends — a clean fixture corpus plus a
deliberately stale mirror the test writes itself, with a control assertion on its
own artifact, verified by a deliberate mutation that reddens it (exit 1).

## 3. `lore assess` scored two MAJOR gaps against files it simultaneously declared unverifiable

Diff was 445736 chars against an 80000 budget, so it truncated. The report's own
"Unverifiable" section names `real-git-port.ts` and
`territory-partition.bun.test.ts` — and two of its three MAJOR findings are
scored against exactly those files.

Both machine-checked FALSE:

- AC-OWN-4 "the trailer silently no-ops in production because core.hooksPath is
  outside the git dir". This repo's `core.hooksPath` IS outside the git dir
  (`/Users/apple/Projects/zz/lore/hooks`), and every commit in this session
  carries a `Lore-Session:` trailer (`96fb2807`, `831bc4d0`, `d31b554c`,
  `49d44c8a`). `real-git-port.ts:650-664` does not return skip unconditionally —
  it runs `git worktree list` and only skips when the hooks dir falls outside
  EVERY working tree, which is the BOUNDARY case the test suite covers on
  purpose.
- AC-OWN-1 "whether `territory.ts` supplies localBranches to `partitionTerritory`
  is asserted only in a truncated test file". `territory.ts:117` reads
  `const localBranches = await listLocalBranches(app.repoRoot);` and lines
  119-123 pass it as the 4th argument. Decidable by `grep`, not by inference.

The third MAJOR (AC-OWN-5: the heartbeat records `process.ppid`, written only by
`lore session list|show`) machine-checked TRUE — `session.ts:149`.

⛔ MECHANIZATION, not prose: a finding whose path appears in the run's own
truncation manifest MUST be emitted as `unverifiable`, never scored as a gap. The
data to enforce this is already in the same report. The prior session measured
1-of-3 MAJORs backwards; this one measured 2-of-3. Two consecutive runs is a
pattern, and the shared cause is now identified.

## 4. The defect channel has no adopt verb

`lore report-issue` creates a task with `plan_id` null. Nothing moves it out of
that state: `lore issue` offers only `resolve` (terminal, derogatory), `lore set`
has no `--plan-id`, `lore plan` offers only plan-close exemptions. So an accepted
defect is indistinguishable from an ignored one — both stay open and plan-less.
Measured: 21 open reports, the four newest all `plan_id: null` at 13h–47m old.

`spec-the-defect-channel-cannot-be-honestly-maintained-an` is approved and greps
ZERO for adopt/assign/plan_id/unowned/orphan, so this is unrecorded. Filed as
`01KZWMWFN9VXRDNJMKFAW0Y7GF`. The workaround used here — create a second task
under a real plan and cite the report ids — leaves the channel's own record
permanently open, which is why the open count measures neither backlog nor
neglect.

## 5. Editing source while a background build-then-test job runs manufactures ~130 false reds

`bun run test:changed` builds `dist/lore` once near the start, then runs
compiled-binary-consumer tests that assert freshness by comparing the newest
`.ts` mtime under `src/` against the binary's. An implementer ran its falsifier
mutate-and-revert cycle while an earlier invocation was still executing; the
edits bumped source mtimes past the already-built binary and every subsequent
binary test in that run tripped the guard. Two full runs discarded. The guard is
correct; the sequencing is the trap. Same class as the corpus-write rule: do not
mutate shared inputs while a measurement over them is in flight.

## 6. `lore evidence --result pass` with a hand-authored tail is refused by the shipped gate

Exit 4, with the reason that a fabricated summary satisfies a bare non-empty
check exactly as well as a genuine one. The dispatch bundle written this session
instructed the implementer to use it — the instruction was stale against the
shipped validation. `lore verify --task ... --ac ... --yes` is the correct path
and is strictly stronger (it attests). ⛔ Dispatch bundles carry command strings
that age against the binary; the implementer caught this and reported it rather
than routing around it, which is the behaviour to reward.

## 7. The root CLAUDE.md byte ceiling forces an eviction before any correction

The ceiling refused a one-line correction with 10 bytes of headroom, correctly.
But the correction being refused was a CORRECTION — an existing line was
actively misleading about which command re-exports the mirror. A ceiling that
treats "add a new lesson" and "fix a wrong lesson" identically will, at
saturation, preserve wrong text by default. Recorded here rather than argued:
the eviction happened, the correction landed, and §1 above is what the pointer
now points at.
