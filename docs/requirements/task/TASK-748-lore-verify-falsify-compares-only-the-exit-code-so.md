---
id: TASK-748
type: task
role: plan
title: "lore verify --falsify compares only the exit code, so an unrunnable scratch worktree mints a proven red from a module-not-found error"
status: draft
priority: medium
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PRD-001
---
The --falsify runner is the corpus's ONLY mechanism for machine-proving that an AC's oracle can fail. It builds a scratch git worktree from 'git stash create', applies the declared mutation there, runs the command, and compares ONLY the observed exit code against the declared one. Measured 2026-08-21 across one session: 11 of 11 invocations recorded result:expected-fail plus capture_source:runner while never executing their mutation — 10 criteria on 3 specs, a 100 percent false-match rate. Three distinct causes, all exiting 1: (1) the scratch worktree has no usable node_modules ('Could not resolve vitest/config', 'Cannot find module @lore/core') — and one row's tail shows a bun install having run and STILL failing, so adding an install step is not sufficient; (2) untracked files are absent because the worktree comes from 'git stash create' WITHOUT the --include-untracked flag, so a red-first AC's brand-new test file is simply not there ('The following filters did not match any test files'); (3) dist/lore is gitignored, so a compiled-binary oracle has no binary ('stale-binary guard: does not exist'). Since 1 is the natural declared value for 'this mutation should make the test fail', no choice of exit code can separate a startup failure from an assertion failure — both vitest and bun test exit 1 for each. The distinguishing signal exists only in the OUTPUT, which the runner never inspects. Caught by lore assess reading evidence tails hours later, and independently by an implementer agent inspecting its own row; never by the runner itself, which exits 0 printing 'exit 1 (declared 1)'. Cause 2 is the sharpest: a red-first AC's test file is by definition new and therefore untracked, so this mechanism is structurally LEAST able to verify exactly the criteria the red-first discipline is built around.
