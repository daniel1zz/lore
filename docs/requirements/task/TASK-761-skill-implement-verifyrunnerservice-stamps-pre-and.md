---
id: TASK-761
type: task
role: plan
title: "[Skill:implement] VerifyRunnerService stamps pre and post, demoting when a real commit lands between them"
status: draft
priority: critical
phase: "P2 Stamp mechanisms"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-137
plan: PLAN-137
links:
  - {id: TASK-758, type: blocks}
---
Estimate: L
Approach: per SPEC-143 AC-CT-5 and C5 (v51). The runner captures the state stamp BEFORE the command and re-reads it AFTER; differing values demote the row. INJECTION SEAM IS PINNED: a real commit in a throwaway git repo landing between the two reads.
Source: SPEC-143 AC-CT-5, C5.
Dimensions: D-FUNC, D-STATE
Scope-Alt: none — without the pre/post pair a peer merge mid-run yields a stamp naming a state the oracle never ran against, which is worse than no stamp because it launders an unsound observation into an attested one.
Covers: AC-CT-5

Blocked by P0 (consumes StateStamp). Highest-risk task in this plan — the seam is timing-sensitive.

⛔ A FAKE GitPort DOES NOT SATISFY THIS. The spec rejects it by name: two differing digests from a stub prove the comparison executes, not that VerifyRunnerService reads the stamp at the seam where a concurrent write can actually land. If the deterministic injection proves impossible, escalate rather than weaken.

AC:
- Given a real commit landing between the pre-run and post-run reads, When the runner finishes, Then the row is demoted and the post-run value is never silently recorded as the measured state.
- Given no commit in the window, Then the row is not demoted (live control).
- Given a demoted row, When read back, Then it identifies the state it was demoted from.
- ⛔ Run the declared falsifier once and record it: record only the post-run stamp, dropping the comparison → the command exits EXACTLY 1.
