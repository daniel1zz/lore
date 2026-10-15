---
id: TASK-762
type: task
role: plan
title: "[Skill:test] pre/post stamp demotion with a real commit in the window — RED test scenarios"
status: deprecated
priority: critical
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-10-10
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
  - {id: TASK-761, type: supersedes}
---
⛔ RESTRUCTURED 2026-08-23: this task ABSORBED `task-skill-implement-verifyrunnerservice-stamps-pre-and-post` (now invalidated, superseded by this doc). Reason, measured: `lore done` carries THREE independent conjunctive floors, and the third — `findMissingUnfilteredTestFileRuns` (`packages/lore/src/service/task-workflow-service.ts:2934`) — demands, for EACH declared `.test.ts` anchor, an `oracle:test result:pass` row running that file UNFILTERED, and offers NO escape hatch (the other two floors do: `--override-attestation`, `--declare-no-new-tests`). A RED-only task whose declared anchor IS the failing test file can therefore never archive, which deadlocks the paired impl task that `blocks` on it. Collapsing the pair into ONE archival unit satisfies all three floors truthfully: the red row comes from stage RED's agent, the attested unfiltered pass from stage GREEN's `lore verify`.

Structure: TWO SEQUENTIAL CLAIMS ON ONE TASK — stage RED then stage GREEN, each claimed by a DIFFERENT agent. Plan A D-A3 is preserved: the party that records the red must have no stake in it passing; the claim lease serialises them, and stage GREEN claims only after stage RED has released.

## Stage RED

Estimate: M
Source: AC of the paired pre/post-stamp task; SPEC-143 AC-CT-5, C5
TDD-Role: red | Paired-Impl: the AC-CT-5 VerifyRunnerService task
Dimensions: D-FUNC, D-STATE

Scenarios:
- Given a throwaway git repo, When a REAL commit lands between VerifyRunnerService's pre-run and post-run stamp reads, Then the evidence row is DEMOTED and the post-run value is not recorded as the measured state.
- Given the same runner with no commit landing in the window, When it completes, Then the row is NOT demoted — the live control proving the demotion is caused by the change, not by the code path always demoting.
- Given the demoted row, When read back, Then it names WHICH state it was demoted from, not merely that it was demoted.
- ⛔ Given a fake GitPort returning two differing digests, When the test uses that instead of a real commit, Then that arrangement does NOT satisfy this criterion — it proves only that the comparison executes, never that the runner reads the stamp where a concurrent write can land. Write the real-commit version.

⛔ HOW TO LAND THE COMMIT INSIDE THE WINDOW, so this is not reverse-engineered from the spec's sequence diagram: the runner's order is read-pre-stamp → RUN THE COMMAND → read-post-stamp, so the command the AC declares is ITSELF inside the window. A command that performs a `git commit` in the throwaway repo lands the state change deterministically between the two reads, with no sleep, no race and no polling. The live control is the same fixture with a command that commits nothing.

AC:
- All four scenarios exist as executable tests, the injection being a real commit in a throwaway repo.
- RED before implementation.
- ⛔ Red recorded by THIS agent at the moment it is red: `lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail --ac AC-CT-5`.
  ⛔ The `--ac` reference is mandatory, not decoration: without it the red is free prose and "which ACs have an observed-red falsifier" stays unqueryable corpus-wide — the exact residual SPEC-143's own Falsifier-debt section names.
- ⛔ If the timing window cannot be hit deterministically, STOP and report — do not substitute a fake port, which the spec rejects by name.


## Stage GREEN — absorbed verbatim from the invalidated impl task

Estimate: L
Approach: per SPEC-143 AC-CT-5 and C5 (v51). The runner captures the state stamp BEFORE the command and re-reads it AFTER; differing values demote the row. INJECTION SEAM IS PINNED: a real commit in a throwaway git repo landing between the two reads.
Source: SPEC-143 AC-CT-5, C5.
Dimensions: D-FUNC, D-STATE
Scope-Alt: none — without the pre/post pair a peer merge mid-run yields a stamp naming a state the oracle never ran against, which is worse than no stamp because it launders an unsound observation into an attested one.
Covers: AC-CT-5

Blocked by P0 (consumes StateStamp). Highest-risk task in this plan — the seam is timing-sensitive.

⛔ THE WINDOW IS REACHABLE WITHOUT TIMING TRICKS: the runner reads the pre-stamp, RUNS THE COMMAND, then reads the post-stamp — so a command that itself commits in the throwaway repo is deterministically inside the window. Build the seam so that ordering holds; if it does not, that is the defect, not the test.

⛔ A FAKE GitPort DOES NOT SATISFY THIS. The spec rejects it by name: two differing digests from a stub prove the comparison executes, not that VerifyRunnerService reads the stamp at the seam where a concurrent write can actually land. If the deterministic injection proves impossible, escalate rather than weaken.

AC:
- Given a real commit landing between the pre-run and post-run reads, When the runner finishes, Then the row is demoted and the post-run value is never silently recorded as the measured state.
- Given no commit in the window, Then the row is not demoted (live control).
- Given a demoted row, When read back, Then it identifies the state it was demoted from.
- ⛔ Run the declared falsifier once and record it: record only the post-run stamp, dropping the comparison → the command exits EXACTLY 1.


⛔ Stage GREEN closes with `lore verify`, NOT a hand-recorded pass — one attested run of the declared AC command must also be an UNFILTERED run of every `.test.ts` anchor on this task, or the third floor above will refuse the archive.
