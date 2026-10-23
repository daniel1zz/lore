---
id: ADR-056
type: adr
role: decision
title: "Issues state problems and live only on GitHub; tasks state execution only, including for problems found in this repository"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
links:
  - {id: SPEC-212, type: relates-to}
  - {id: SPEC-193, type: relates-to}
---
## Context

An issue describes a problem; a task describes execution. Lore mixed them in two ways:

1. Every GitHub issue had a corpus mirror task (`task-gh-*`) that was supposed to own its resolution. Measured 2026-10-19: 278 unclaimed mirror tasks among 406 unclaimed tasks; 53 with a terminal verdict (rejected / duplicate / superseded) that can never reach `archived` because a verdict is not execution; 157 mirrors still draft while GitHub says closed. `spec-github-owns-issue-report-state-no-mirror-task-work-carries` (approved) already removes mirrors.
2. Problems found while developing lore itself were barred from the issue channel (BR-1153; root CLAUDE.md "Never `lore report-issue` from this repo"; draft spec "In-repo lore defect backlog", user decision 2026-10-16) and recorded as draft tasks in backlog plans or ad-hoc tasks whose title and body state a problem, not an action.

## Decision (user, 2026-10-19)

- Every problem goes to GitHub as an issue, including problems found while developing lore in this repository (upstream `daniel1zz/lore`, public; the filing path's redaction applies). GitHub is the only owner of a problem's existence, open/closed state, verdict and discussion.
- A task is execution only. It is created when work starts and names the issues it resolves; a task never states a problem as its subject.
- Simple problems found in a session are still fixed in place (≤2 files, existing oracle, no approved-spec behaviour change), with no issue.
- This reverses the 2026-10-16 decision behind BR-1153 and the in-repo defect backlog.

## Consequences

- BR-1153, root CLAUDE.md (Dogfooding: the "Never `lore report-issue`" line), `assets/context/corpus-workflow-4-close.md` and the ACs citing BR-1153 (AC-ISCOPE-1, AC-UPK-1..3, AC-BKL-1, AC-R0-1..2) change to this decision.
- The draft spec "In-repo lore defect backlog" and its 8 draft backlog plans are retired; their problem-shaped tasks are filed as issues and removed.
- Ad-hoc tasks that state a problem (e.g. task-mirror-human-ids-diverge-from-lore-get-spec-205-names-two, task-lore-done-s-no-new-tests-refusal-suggests-a-captured-red, task-a-released-claim-still-reads-as-locked-and-blocks-other) are filed as issues.
- Order: the GS spec lands first (GitHub owns issue state, mirrors removed, local-only reports filed); the rule change and backlog retirement follow.
- The user's global rule fragment (`~/.config/lore/context/user-09-behavior.md`) was updated the same day.
