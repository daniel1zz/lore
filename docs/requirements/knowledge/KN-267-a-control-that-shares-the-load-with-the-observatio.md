---
id: KN-267
type: knowledge
role: knowledge
title: "A control that shares the load with the observation is not a control: an A/B at base reproduced a contention artifact and read as 'pre-existing'"
status: approved
priority: high
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## The finding

An A/B control does **not** neutralize a load artifact when both arms run under
the same load. Stashing your change and re-running at base is the right *shape*
of control, and it is worthless against a failure whose cause is contention —
because the base arm reproduces the artifact just as faithfully as the treatment
arm, and the matching red reads as proof the defect is pre-existing.

## Measured, 2026-07-31

A dispatched implementer finished its task and reported, as a concern for the
orchestrator:

> `bun run test:changed c52f043` has 1 pre-existing failure, not mine.
> `tests/integration/cli/issue-report-concurrency.bun.test.ts` AC-IC-1 fails on
> `database is locked`. I did not assume — I stashed my four source files,
> rebuilt, and re-ran it at base: it fails identically without my changes.

Its discipline was better than most: it did not merely assert "not mine", it
constructed a control. It then reasoned one step further, that the co-resident
session's `c6ab699` (which stopped excusing governed-path uncaught throws as
`not_attributable`) had surfaced a real pre-existing concurrency defect.

The orchestrator re-ran the same file **in isolation** on the merged main:

```
ISOLATED_EXIT=0
[AC-IC-1] sampling power: CONCLUSIVE — full sample collected
[AC-IC-1]   collected (contract-readable) runs: 50/50 (floor 20)
[AC-IC-1]   excluded (not attributable) runs:   0 [none]
 4 pass | 0 fail | Ran 4 tests across 1 file. [101.56s]
```

Zero failures, and the harness itself certifies the sample was complete. The
suite takes **101 seconds alone** — it is spawn-heavy, and under the N-way
concurrency of a full `test:changed` sweep (plus a co-resident session running
its own suites) it starves into `database is locked`. Both of the implementer's
arms ran inside that same sweep, so both starved, so the control could not
discriminate.

## Why the wrong conclusion was reachable

The implementer's inference chain was locally sound at every step — the failure
was real, the base re-run did fail, `c6ab699` genuinely did narrow an exclusion
branch, and the failing runs genuinely were uncaught `bun:sqlite` throws during
`init`. Every link held. The chain still terminated in a false conclusion,
because the shared premise ("both runs measured the code, not the environment")
was never itself tested.

This is a distinct failure mode from the catalogued false-oracle vectors, all of
which are about a command not measuring what it claims. Here the command
measured exactly what it claimed — under an environment that was itself the
independent variable.

## Mechanization

The repo already carries the operational half of this lesson
(`CLAUDE.md`: full suites run once, by the orchestrator, on main; and
"Serialize Playwright suites against a fixed dev-server port"). What was missing
is the **inferential** half, and one concrete affordance:

1. A load-sensitive suite must not be diagnosed from any run that shared a
   machine with other suites. Before concluding "pre-existing", re-run the
   single file **alone**. Cost here: 101 seconds, against a conclusion that
   would have sent someone hunting a nonexistent concurrency defect in another
   session's merge.
2. `issue-report-concurrency.bun.test.ts` already reports its own sampling power
   (`CONCLUSIVE` / collected / excluded / attempts) — added by `549b2c8`
   precisely so a degraded run announces itself. **Read that block before
   judging the suite.** A run that starves does not print `CONCLUSIVE`; the
   discriminator was already on screen and unconsulted. Any harness with a
   self-reported power line should be treated the same way.
3. A subagent reporting a foreign red should state whether its control ran under
   the same load as the observation. "I re-ran at base" and "I re-ran at base,
   alone" are different claims, and only the second one settles a contention
   symptom (`database is locked`, timeouts, port contention, OOM).

## Second instance, same session, stronger control — and the definitive measurement

The sibling implementer (`task-plan-close-must-block-when-the-coverage-conjunct-
is-scope`) reported the SAME two suites red and reached the SAME conclusion,
having built a **more** rigorous control than the first:

> The 2 remaining bun failures are not mine — measured, not assumed. `AC-IC-1`
> and `AC-072-9 / AC-IC-5`, both SQLite `database is locked`. I built a throwaway
> worktree at base `c52f043` with a base-built `dist/lore` and none of my
> changes, and reproduced both identically. They belong to the co-resident
> session's area — plausibly surfaced by its own `c6ab699`.

A separate worktree, a separately-compiled base binary, both failures reproduced.
By every ordinary standard that is a decisive control. It was still wrong, for
the one reason no amount of rigor *inside* the arm can fix: the base arm ran in
the same loaded machine as the treatment arm.

Two independent agents, with different control designs, converging on the same
false attribution is the useful part of this record. It is not a lapse by either
one — it is a blind spot in the CONTROL DESIGN both inherited.

The orchestrator's settling measurement, on clean main at `d4df972` with both
agents finished and the machine quiet:

```
bun run test:vitest        → exit 0   Test Files 414 passed (414)   Tests 7059 passed | 4 skipped
cd packages/lore && bun test .bun.test → exit 0   1654 pass  0 fail   Ran 1654 tests across 154 files [428.21s]
```

Zero failures. Both "pre-existing defects in the co-resident session's area" were
artifacts of the machine, and the speculative causal story attaching them to
`c6ab699` was pure narrative — plausible, specific, mechanism-shaped, and false.
Note that the story's plausibility is what made it dangerous: it named a real
commit that really did narrow a real exclusion branch.

## Standing form

> A control that shares the suspected confounder with the observation is not a
> control. For contention symptoms, isolation — not repetition at base — is the
> discriminating variable.

## Source

Orchestrator verification of `task-lore-evidence-must-refuse-a-t-filtered-pass-with-no`,
2026-07-31. Related: `knowledge-session-process-review-2026-07-31-ten-agent-two-wave`;
the AC-IC-1 sampling-power harness landed in `549b2c8` /
`task-ac-ic-1-harness-runs-out-of-sampling-budget-under-load`.
