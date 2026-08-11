---
id: PLAN-127
type: plan
role: plan
title: "Land defect-channel honesty: a resolution-keyed cap, two non-derogatory terminal states, corpus-naming reads, and AC oracle generations"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: SPEC-139
phases:
  - {name: "cap-honesty"}
  - {name: "cap-policy"}
  - {name: "read-surfaces"}
---
# Goal

Land the six mechanisms of `spec-the-defect-channel-cannot-be-honestly-maintained-an`
so a consuming project can file a defect report, see the same queue from every read
surface, and retire a report without derogating it.

# Phases

**Phase 1 — cap-honesty.** The Critical half. Two tasks with DISJOINT file anchors,
dispatched concurrently.

- The terminal-resolution SSOT (`TERMINAL_ISSUE_RESOLUTIONS`), the two
  non-derogatory members, the resolution-keyed cap count, and the structured refusal
  payload — M1 + M3, AC-DC-1/2/4/9. These are one edit: the same union, the same set,
  the same counting narrowing. Splitting them would ship a terminal state the cap
  cannot see, which is the defect being fixed.
- AC oracle generations — M5, AC-DC-8. Touches only `acceptance.ts` / `ac-service.ts`
  / the evidence write path, none of which the issue channel touches.

**Phase 2 — cap-policy.** M2, AC-DC-3. Serialized AFTER phase 1 because it edits the
same two files (`core/issue-report.ts`, `service/issue-report-service.ts`) phase 1's
first task rewrites — the anchor mutex would refuse a concurrent claim, correctly.

**Phase 3 — read-surfaces.** M4 + M6, AC-DC-5/6/7. Serialized after phase 2 for the
same reason (`commands/issues.ts`, `commands/report-issue.ts`,
`service/issue-report-service.ts`). Grouped as ONE task because "name the corpus you
read", "read the upstream by default", and "carry the triage columns" all land in the
same two render paths, and a partial landing would leave one surface naming a corpus
the other does not.

# Risks

- **Cross-plan anchor collisions are invisible.** The sibling plan for
  `spec-a-write-side-fact-with-no-read-side-address-counts-with-no` runs concurrently.
  The anchor mutex and `lore ready`'s `anchor_conflicts` are both PLAN-scoped, so
  neither can see a collision across the two plans. Mitigation: the two plans' anchor
  sets were compared by hand before dispatch and are disjoint; every merge is
  followed by a `git diff --stat` overlap check rather than trusting the gate.
- **Concurrent worktrees must not rebuild the shared binary.** The global `lore`
  symlinks into the MAIN checkout's `dist/`. Integration tests here spawn a compiled
  binary resolved relative to their OWN repo root, so each worktree builds its own
  `dist/lore` — but a build run from the main checkout while an agent is live would
  swap the binary underneath it.
- **`assertFreshBinary` makes the compiled-binary integration ACs build-dependent.**
  Every task whose oracle spawns the CLI must `bun run build` inside its own worktree
  before running that oracle, or the guard fails for a reason unrelated to the fix.

# Verification

Every AC is script-mode with a runner-attested pass required (`lore verify <plan>
--task <task>`). Each task additionally records the RED observation at the moment it
is red (`lore evidence --result expected-fail`), by the agent that produced it — a
transcription by the orchestrator afterwards does not count.
