---
id: KN-499
type: knowledge
role: knowledge
title: "Four gaps measured while landing the discovery-refusal guard's second write path: a mirror that reports OK without comparing content, an unattachable red, a quota that drops the newest evidence, and a wrapper exit code"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PRD-001
---
Four gaps measured on 2026-08-23 while landing AC-OX-12 (the discovery-refusal
guard's second write path). Each is reproducible and each names what refuses it
today — in three of the four cases, nothing does.

## 1. `bun run mirror:export` prints OK for all six types while never comparing content

Measured directly. After editing `spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a`
(v20 -> v21, one paragraph in its Acceptance Criteria section), `bun run mirror:export`
exited 0 and printed, for each of prd/spec/adr/knowledge/plan/task:

    OK — every corpus <type> has a mirror file (count and slug parity; file CONTENT is not compared).

`grep -c "hand-copied id range" docs/requirements/spec/SPEC-130-*.md` returned **0** after
that run. The mirror still carries the pre-edit body.

The parenthetical is honest about the limitation, which makes the surrounding "OK" worse,
not better: the line asserts a property (parity) that a reader takes for the document being
current. In the SAME run, `TASK-749`'s file WAS rewritten — because its frontmatter status
changed (draft -> archived). So the exporter is not inert: it rewrites on frontmatter change
and skips on body change, which is precisely the shape that makes the defect invisible.
A reader who sees some files rewritten concludes the exporter works.

Existing defect: `task-mirror-export-never-rewrites-an-existing-file-whose`. This is a fresh
instance with a named file, not a new finding.

⛔ What refuses this: nothing on the push path. The pre-push hook does not run the mirror
check. The vitest suite does (`scripts/tests/spec-mirror-export.test.ts`), but a test is not
a gate until something invokes it.

## 2. A red-first evidence row recorded without `--ac` can never be attached to its criterion

The implementer recorded its RED the moment it observed it — correct per discipline — but
omitted `--ac AC-OX-12`. The row is real (`capture_source: runner`, 4000-byte tail carrying
8 genuine vitest failures naming `findCapturedFailDiscoveryRefusal is not a function`), yet
it does not appear in `lore ac list`'s refs for AC-OX-12; only the later `inconclusive` and
`attested_pass` rows do.

There is no retroactive `ac_ref` writer. The two available moves are both wrong:
- backfill a NEW row now -> misrepresents when the red happened;
- leave it -> the criterion's coverage silently understates its evidence.

The implementer chose the second and flagged it against itself, which is the right call and
also the one that loses information. ⛔ The gap is the missing writer, not the choice.

## 3. The defect-channel quota suppressed a newly measured defect

`lore issues` shows 10 open reports for this project — the cap. A CLI parsing defect measured
in the previous session (citty parses a `--description` value that begins with `--` as a flag
rather than as the value) has no corpus record at all: `lore search` returns nothing for it,
and it cannot be filed while the channel is full.

A cap sized to protect a triage queue also throttles evidence intake. ⛔ The failure mode is
that the newest, freshest measurement is the one that gets dropped, because the backlog was
filed first. Whatever the right cap policy is, "silently unfileable" is not it — there is no
overflow path, no deferred queue, and no signal to the reporter beyond the refusal.

## 4. A background command's reported exit code is the WRAPPER's, not the suite's

Twice this session the harness's task notification said "completed (exit code 0)" for runs
that had not succeeded:
- `bun run test` -> vitest reported `Test Files 4 failed | 516 passed`, real exit 1;
- `bun run test:bun` -> killed by SIGTERM, real exit 143, suite never finished.

Both were wrapped as `<cmd> > log 2>&1; echo "EXIT=$?" >> log`. The trailing `echo` succeeds,
so the wrapper exits 0 and the notification faithfully reports the wrapper. Only the line the
wrapper itself wrote into the log carried the truth.

⛔ Generalises beyond this harness: this is the same shape as the repo's own "exit code not
measured through a pipe" rule. The mitigation that worked was writing the real `$?` into the
log and reading it back from there — never trusting the completion summary. A run that is
KILLED is the dangerous case: it looks like a finished green run from the outside, and its
partial log has no failure lines to contradict that.
