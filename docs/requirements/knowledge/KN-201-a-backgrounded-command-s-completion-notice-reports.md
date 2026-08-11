---
id: KN-201
type: knowledge
role: knowledge
title: "A backgrounded command's completion notice reports the shell's exit code, not your oracle's"
status: approved
priority: medium
created: 2026-08-04
updated: 2026-08-04
tags: []
parent: PRD-001
---
# Retro — a backgrounded command's completion notice reports the SHELL's exit code, not your oracle's

## What happened

The authoritative `bun run test:bun` full-suite run outgrew the foreground tool's 10-minute ceiling
(measured 690.83s at `75d05cb`, up from 503s a day earlier) and was killed mid-run with **exit 143**
(SIGTERM). Re-running it in background mode, the completion notification read:

> Background command "Rerun full bun suite in background" completed (**exit code 0**)

That 0 was NOT the suite's exit code. The command was:

```
bun run test:bun > log 2>&1; echo "BUN_EXIT=$?" > exitfile; cat exitfile
```

The notification reports the exit status of the WHOLE shell invocation, whose last statement is
`cat` — which succeeds regardless of what the suite did. Had the suite failed, the notice would
still have said `exit code 0`. The real status was only recoverable because `$?` had been captured
to a file immediately after the suite, and read back explicitly (`BUN_EXIT=0`, 1807 pass / 0 fail).

## Mechanism root — the same shape as the piped-`$?` trap, one layer out

This repo already mandates measuring exit codes without a pipe, because `cmd | tail` yields the
pipe's status. A backgrounded compound command has the identical defect at the notification layer:
the reported status belongs to the last statement, not to the oracle. Any trailing `cat`, `echo`,
`tail`, or cleanup step silently overwrites the signal with success.

⛔ It fails in the SAFE-LOOKING direction: a green notice on a red suite. Nothing about the notice
distinguishes the two.

## The rule

⛔ **When backgrounding an oracle, capture `$?` to a file on the very next statement and read that
file back. Never treat a background completion notice's exit code as the oracle's verdict.**

Corollaries measured here:
- Put nothing after the capture that you would mind being reported instead — or better, let the
  capture be the last statement.
- A foreground run that dies at exactly the tool ceiling reports **143**, not a test failure.
  Distinguish "killed by timeout" from "the suite failed": grep the log for a runner summary before
  concluding anything about correctness. In this incident the partial log showed 0 failures and
  steady progress, which is what identified the cause as duration rather than a regression.
- Suite duration drifts upward as tests are added. A suite that fits the ceiling today may not
  tomorrow; the ceiling is not a property of the suite.
