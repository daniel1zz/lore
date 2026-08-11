---
id: TASK-666
type: task
role: plan
title: "Thread diff_source through the CLI and MCP assess adapters so path verification is reachable from the surfaces users drive"
status: draft
priority: medium
phase: "assess-verify"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-123
plan: PLAN-123
---
# Objective

Close AC-JV-5. `commands/assess.ts` and the MCP `tools.ts` never thread `opts.diffSource` into the service, so **every live `lore assess` run resolves to `paths_verified.unchecked`** — the path verification AC-JV-1 proved at the service layer is unreachable from the only two surfaces anyone drives.

Measured 2026-08-11, immediately after AC-JV-1 earned an attested pass. Reported unprompted by the implementer who found it outside its own anchors; ⛔ this is an anchor-and-scope defect in the parent spec (now corrected as D6), not an execution failure.

# Acceptance

**AC-JV-5** only — read the full statement via `lore get 01KZR7GP6C`. Both adapters, the STORED doc (not an in-memory return), and the mandatory `diff_source`-absent reverse control.

# Notes

⛔ Fifth measured instance of the same shape in this repo: an added column nobody writes, a function nobody calls, a parameter no caller passes, an accepted option no CLI threads, and now a resolved `diffSource` no adapter supplies. Drive the OUTERMOST surface.
