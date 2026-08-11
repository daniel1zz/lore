---
id: TASK-453
type: task
role: plan
title: "T2 — unit oracles for the coverage-check verb"
status: archived
priority: medium
phase: "oracles"
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-086
plan: PLAN-086
---
# T2 — unit oracles for the coverage-check verb (AC-RCH-1..6, AC-RCH-8)

## Task Objective

Write the independent unit oracles that pin seven of the eight acceptance criteria. You did not write the implementation and must not change it — if an AC cannot be made to pass, report that as a finding rather than adjusting the source.

## Spec Reference

`spec-resume-ticket-coverage-floor-blocking-channel-arming`, decisions H1–H6 and criteria AC-RCH-1, 2, 3, 4, 5, 6, 8. Every criterion statement names its own control arm — the control is part of the criterion, not optional decoration. H6 exists because the predecessor spec's AC asserted "exits non-zero", which passed for eight days over a mechanism with zero measured effect; do not write an assertion that could pass the same way.

## What each oracle must establish

- **AC-RCH-1** (`-t "block decision"`) — incomplete accounting: exit 0, stdout parses as ONE JSON object with `decision === "block"`, stderr id set SET-EQUAL to the omitted subset (not containment — extra or missing ids must fail). Control: full coverage on the same fixture → stdout empty.
- **AC-RCH-2** (`-t "reason template"`) — the reason contains the three disposition constants asserted by IDENTITY against the `@lore/core` exports, and each per-id line ROUND-TRIPS through the same disposition parser the verb uses, yielding exactly that id. Plus a zero-hit search over the verb source for a hand-typed marker literal.
- **AC-RCH-3** (`-t "hook relays block"`) — with a stub binary earlier on `PATH` emitting a known block JSON at exit 0, the UNMODIFIED hook reproduces that stdout byte-for-byte and exits 0. Control: the hook source still yields zero hits for every exported id prefix and disposition token.
- **AC-RCH-4** (`-t "arming provenance"`) — ticket text in a `tool_result` whose originating call is NOT a session-resume feed → exit 0, empty stdout. Control: byte-identical ticket text paired by `tool_use_id` with a real feed call → block decision. Without the control the negative half passes vacuously.
- **AC-RCH-5** (`-t "provenance shapes"`) — exhaustive iteration over a structured fixture array: bare `lore` call / dist-path call with extra flags / MCP `lore_feed` with a `session-resume` checkpoint / flags interleaved BETWEEN the two tokens / tokens in reversed order → all yield a block decision; `cat` and `grep` transporting the same text → empty stdout; a multi-actor-render fixture (ordinals present, `RESUME_COVERAGE_FLOOR` absent) → empty stdout even from a genuine feed call, which is the SPEC-112 D10 regression guard.
- **AC-RCH-6** (`-t "cross-turn"`) — a complete disposition set in an EARLIER post-ticket assistant message while `last_assistant_message` has none → exit 0, empty stdout. Control: that earlier message carries only a proper subset → block naming SET-EQUAL the remainder.
- **AC-RCH-8** (`-t "exit status carries no verdict"`) — five payload classes (incomplete / complete / no-ticket / malformed stdin / unreadable transcript path) ALL exit 0; only stdout separates them.

## Coverage discipline

Six-dimension coverage across the file: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION. Write the failing assertion first and watch it go red before the implementation satisfies it — a test authored green proves nothing. Report any AC you could not cover.

## File Anchors

`packages/lore/tests/unit/handoff-coverage-check.test.ts` only. Do not touch the verb source or the e2e file.

## Oracle

`bun install` FIRST in the worktree, then run the seven filtered vitest invocations from the AC commands. After every filtered run assert the matched file count (`Test Files 1`) — vitest silently drops non-matching path filters and a PARTIAL match still exits 0.
