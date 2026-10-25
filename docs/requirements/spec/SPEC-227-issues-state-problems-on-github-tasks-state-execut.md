---
id: SPEC-227
type: spec
role: spec
title: "Issues state problems on GitHub, tasks state execution: shipped guidance and this repository file every unfixed problem as an issue"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-20
tags: []
---
## Overview/Goal

Implements `adr-issues-state-problems-and-live-only-on-github-tasks-state` (user decision 2026-10-19): an issue states a problem and lives in the project's issue repository; a task states execution and names the issues it resolves. This reverses the 2026-10-16 decision that barred problems found while developing lore from the issue channel. Carries the rule change set: modify BR-1153.

## Scope

In scope:
- The close-phase session guidance lore ships (`assets/context/corpus-workflow-4-close.md`, rendered into `.claude/rules/lore-corpus-workflow-close.md`): its report-issue bullet tells an agent to file every problem it does not fix in place as an issue, including in the tool's own repository; work on a problem is a task naming the issues it resolves; never a task whose subject is the problem.
- This repository's root CLAUDE.md Dogfooding section: drop "Never `lore report-issue` from this repo"; state the same rule.
- Rule change set: modify BR-1153.
- AC-ISCOPE-1 (spec-the-shipped-close-guidance-scopes-defect-reports-lore) asserts the old wording. In the same landing as the fragment change, the main agent runs `lore ac supersede spec-the-shipped-close-guidance-scopes-defect-reports-lore AC-ISCOPE-1` naming this spec's AC-IGH-1, so verify skips it and its oracle is never run against the new wording.

Out of scope (separate work, after spec-github-owns-issue-report-state-no-mirror-task-work-carries lands): filing existing problem-shaped tasks as issues; retiring the draft in-repo defect backlog spec and its 8 backlog plans. The issue filing path itself is owned by that GS spec.

Simple problems found in a session are still fixed in place with no issue (≤2 files, an existing oracle proves the fix, no approved-spec behaviour change).

## Acceptance Criteria

AC-IGH-1, AC-IGH-2 (`lore ac list`).


## Acceptance Criteria (structured)

- [⚑] [script] AC-IGH-1: assets/context/corpus-workflow-4-close.md's report-issue bullet contains 'one root cause', 'file it as an issue', 'including in the tool's own repository', 'a task names the issues it resolves' and 'never a task whose subject is the problem', and does not contain 'plan/task work' or 'not a report'; the repo's compiled .claude/rules/lore-corpus-workflow-close.md is byte-identical to a fresh render of that fragment; 'lore fragments check' exits exactly 0. Smallest red mutation: deleting 'a task names the issues it resolves' from the fragment makes the test exit 1.
  script: test — bunx vitest run packages/lore/tests/unit/context/issue-channel-guidance.test.ts -t 'AC-IGH-1'
- [⚑] [script] AC-IGH-2: This repository's root CLAUDE.md Dogfooding section contains 'file it as an issue' and 'a task names the issues it resolves', and contains no line forbidding 'lore report-issue' from this repository (no match for 'Never `lore report-issue`'). Smallest red mutation: replacing 'file it as an issue' with 'Never `lore report-issue` from this repo' in CLAUDE.md makes the test exit 1.
  script: test — bunx vitest run packages/lore/tests/unit/context/issue-channel-guidance.test.ts -t 'AC-IGH-2'

## Code anchors

- assets/context/corpus-workflow-4-close.md
- CLAUDE.md
