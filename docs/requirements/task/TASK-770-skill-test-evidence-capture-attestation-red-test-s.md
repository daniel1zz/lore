---
id: TASK-770
type: task
role: plan
title: "evidence-capture attestation — RED scenarios then the write-through (AC-CT-2)"
status: archived
priority: high
phase: "P1 Independent labels"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
  - {id: TASK-769, type: supersedes}
---
Estimate: S (red) + S (green)
Source: SPEC-143 AC-CT-2 and C5
Structure: TWO SEQUENTIAL CLAIMS ON ONE TASK — stage RED then stage GREEN, each claimed by a DIFFERENT agent.
Dimensions: D-FUNC, D-CODE

⛔ RESTRUCTURED 2026-08-23: this task ABSORBED `task-skill-implement-evidence-capture-writes-a-real-attestation` (now invalidated, superseded by this doc). Reason, measured: `lore done` carries THREE independent conjunctive floors, and the third — `findMissingUnfilteredTestFileRuns` (`packages/lore/src/service/task-workflow-service.ts:2934`) — demands, for EACH declared `.test.ts` anchor, an `oracle:test result:pass` row running that file UNFILTERED, and offers NO escape hatch (the other two floors do: `--override-attestation`, `--declare-no-new-tests`). A RED-only task whose declared anchor IS the failing test file can therefore never archive, which deadlocks the paired impl task that `blocks` on it. Collapsing the pair into one archival unit satisfies all three floors truthfully and needs ZERO overrides: the red row comes from stage RED's agent, the attested unfiltered pass from stage GREEN's `lore verify`.

Why the two stages stay two AGENTS (plan A D-A3, preserved): the party that records the red must have no stake in it passing. The claim lease serialises them; stage GREEN claims only after stage RED has released.

## Stage RED — DONE 2026-08-23 (agent:ct-t1-test-attest, merged as 32143dc2)

Scenarios:
- Given a throwaway corpus (mkdtemp + lore init, cwd inside it — ⛔ NEVER this repo's .lore/), When a passing oracle run is recorded through the REAL evidence-capture path, Then the stored row has capture_source "runner" AND an attestation block containing a measured exit_code.
- Given the same run, When the stored row is read back, Then attestation carries the elapsed time and the timed_out flag the adapter already measures from spawnResult — not placeholders.
- Given a run that FAILS (non-zero exit), When recorded through the same path, Then the attestation block is present with the real non-zero exit_code, so attestation presence is not conditional on success.
- ⛔ Given the schema alone, When inspected without driving the capture path, Then that inspection does NOT satisfy this criterion — AC-CT-2 requires driving production wiring end to end.

AC (met):
- All four scenarios exist as executable tests against a throwaway corpus: `packages/lore/tests/unit/adapters/evidence-capture-attestation.test.ts`.
- Running them before the implementation is RED, failing because the attestation block is absent — not because the test is malformed. Independently reproduced on merged main by agent:main-orchestrator: exit EXACTLY 1, 4 failed, every failure printing the stored row with capture_source=runner and attestation undefined, zero FIXTURE FAILURE.
- ⛔ Red recorded by the producing agent at the moment it was red, `--result expected-fail --ac AC-CT-2`.

## Stage GREEN — OPEN

Approach: per SPEC-143 C5 — the adapter ALREADY measures spawnResult.status, elapsedMs and timed_out and simply never writes them. This is a write-through fix, not new measurement.

⛔ Anchor correction 2026-08-23: the absorbed task declared `packages/lore/src/adapters/cli/evidence-capture.ts`, a path that DOES NOT EXIST. The real production file is `packages/lore/src/adapters/evidence-capture.ts` (no `cli/` segment), declared on this task. `lore status --check-drift` exits 0 with the wrong path present, so task `file_anchors` are not drift-checked — an implementer following the old anchor would have created a second file in the wrong directory.

Independent of the P0 type foundation — consumes no new type, so it dispatches immediately and runs parallel to P0.

AC:
- Given a throwaway corpus, When a passing oracle run is recorded through the real evidence-capture path, Then the persisted row carries capture_source "runner" AND an attestation block whose exit_code is the measured spawn status.
- Given a failing run through the same path, When the row is read back, Then the attestation block is present with the real non-zero exit_code — presence is unconditional on outcome.
- Given the corpus after the change, When every evidence row is scanned, Then ZERO rows carry capture_source "runner" without an attestation block.
- ⛔ Run the declared falsifier once and record it: delete the attestation write while leaving the runner label in place, and assert the AC-CT-2 command exits EXACTLY 1. A pass never observed able to fail is not evidence.
- ⛔ Use a throwaway corpus for every smoke check. Writing to this repo's .lore/ is forbidden (2026-07-07 pollution incident).
- ⛔ Stage GREEN closes with `lore verify` — NOT a hand-recorded pass. AC-CT-2's declared command is exactly this task's `.test.ts` anchor run unfiltered, so one attested `lore verify` row satisfies BOTH the attestation floor and the unfiltered-test-file floor.
