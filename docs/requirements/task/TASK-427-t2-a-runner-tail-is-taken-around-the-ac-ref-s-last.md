---
id: TASK-427
type: task
role: plan
title: "T2 — a runner tail is taken around the ac_ref's last occurrence, not the stream end"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-083
plan: PLAN-083
---
Make a runner-produced `output_tail` witness the criterion its row is filed under.

Today `verify-executor.ts:150` does `tailChars(stdout + stderr, OUTPUT_TAIL_MAX_CHARS)` —
the literal end of the stream. When a run emits more than the cap AFTER the AC's own
result line, the stored tail shows unrelated later output and the AC's own line is gone.

## Required

When the evidence row carries an `ac_ref` and that AC id occurs in the captured stream,
store the window around the id's LAST occurrence instead of the stream end. When the id
does not occur, behaviour is unchanged — silently, since many oracle kinds never print
the AC id.

Prefer extracting the window selection as a PURE function so it is vitest-testable
without spawning (the existing executor coverage is
`tests/integration/verify-executor.bun.test.ts`, a bun test — a pure helper keeps the new
ACs in the vitest tier where AC-ETI-7/8 place them).

## Control

AC-ETI-8 pins the no-match path to be BYTE-IDENTICAL to the current stream-tail result.
Capture the pre-change output for a no-match input and assert against that exact string —
do not assert a property that both old and new code satisfy vacuously.

## Verification discipline

Red first, and record the red with a non-empty `output_tail`.
