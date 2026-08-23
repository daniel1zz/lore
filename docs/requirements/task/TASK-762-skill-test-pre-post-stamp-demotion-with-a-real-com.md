---
id: TASK-762
type: task
role: plan
title: "[Skill:test] pre/post stamp demotion with a real commit in the window — RED test scenarios"
status: draft
priority: critical
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-761, type: blocks}
---
Estimate: M
Source: AC of the paired pre/post-stamp task; SPEC-143 AC-CT-5, C5
TDD-Role: red | Paired-Impl: the AC-CT-5 VerifyRunnerService task
Dimensions: D-FUNC, D-STATE

Scenarios:
- Given a throwaway git repo, When a REAL commit lands between VerifyRunnerService's pre-run and post-run stamp reads, Then the evidence row is DEMOTED and the post-run value is not recorded as the measured state.
- Given the same runner with no commit landing in the window, When it completes, Then the row is NOT demoted — the live control proving the demotion is caused by the change, not by the code path always demoting.
- Given the demoted row, When read back, Then it names WHICH state it was demoted from, not merely that it was demoted.
- ⛔ Given a fake GitPort returning two differing digests, When the test uses that instead of a real commit, Then that arrangement does NOT satisfy this criterion — it proves only that the comparison executes, never that the runner reads the stamp where a concurrent write can land. Write the real-commit version.

AC:
- All four scenarios exist as executable tests, the injection being a real commit in a throwaway repo.
- RED before implementation.
- ⛔ Red recorded by THIS agent at the moment it is red (lore evidence --result expected-fail).
- ⛔ If the timing window cannot be hit deterministically, STOP and report — do not substitute a fake port, which the spec rejects by name.
