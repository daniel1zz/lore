---
id: TASK-757
type: task
role: plan
title: "Run the unmutated green control before the mutation and downgrade an unrunnable scratch worktree to inconclusive"
status: archived
priority: medium
phase: "green-control"
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-136
plan: PLAN-136
---
## What is wrong

`_runFalsifier` (verify-runner-service.ts, steps 3-8 of its own JSDoc walkthrough) does:

    3. createFalsifierScratchWorktree
    4. applyFalsifierMutation
    5. spawn verify.command from the scratch worktree
    6. compare the observed exit code to falsifier.expected_exit_code EXACTLY
    7. on a match, record result:expected-fail + capture_source:runner
    8. finally, removeFalsifierScratchWorktree

Step 6 is the whole test. Measured 2026-08-21: 11 of 11 invocations matched and recorded, and NONE had executed its mutation — a 100% false-match rate over 10 criteria on 3 specs. Three causes, ALL exiting 1:

1. the scratch worktree has no usable node_modules ('Could not resolve vitest/config', 'Cannot find module @lore/core'). One row's tail shows a `bun install` having run and STILL failing, so adding an install step is NOT sufficient.
2. untracked files are absent — the worktree comes from `git stash create` WITHOUT --include-untracked ('The following filters did not match any test files').
3. dist/lore is gitignored, so a compiled-binary oracle has no binary ('stale-binary guard: does not exist').

Since 1 is the natural declared value for 'this mutation should make the test fail', NO choice of exit code separates a startup failure from an assertion failure — vitest and bun test both exit 1 for each. The distinguishing signal exists only in the OUTPUT, which the runner never inspects.

## What to build

A GREEN CONTROL, inserted between step 3 and step 4: spawn the AC's verify.command in the SAME scratch worktree with NO mutation applied. Reuse the SAME injected `executor` port and the same `buildVerifySpawnSpec` shape step 5 already uses (repoRoot: scratch.worktreeDir) — do not add a second spawn mechanism.

- Green control exits 0 -> the environment is usable. Proceed to step 4 unchanged. Every existing behaviour must be byte-identical on this path.
- Green control exits NONZERO -> the environment is unusable. Record `result: "inconclusive"` with NO attestation block, and a warnings entry naming the green control and the observed exit code. Do NOT apply the mutation, do NOT record expected-fail, do NOT exit 0 claiming a proven red.

Surface the outcome on the `--falsify` CLI branch (commands/verify.ts) so a human and an agent both see 'green control failed -> inconclusive' rather than a silent success. ⛔ An implementation whose only evidence is a service-level test does NOT satisfy AC-FR-11 — the criterion's prose names the recorded RESULT, so the oracle must observe the recorded row.

## Constraints

- ⛔ RED FIRST, and record it yourself the moment it is red: `lore evidence <this-task> --oracle test --command '<cmd>' --result expected-fail` with the real failing tail. An orchestrator transcribing your red later does NOT count.
- The new test goes in `packages/lore/tests/unit/service/attested-red.test.ts` under a describe whose LAST em-dash-separated segment is the kebab token `green-control`, because AC-FR-11's command selects it with -t "green-control". That file already drives `createFalsifierScratchWorktree` / `applyFalsifierMutation` / `removeFalsifierScratchWorktree` directly as plain exported functions — follow that existing pattern rather than mocking the class.
- Construct the unrunnable environment genuinely (e.g. a scratch worktree whose command references a path that only exists untracked). ⛔ Do not simulate it by stubbing the executor to return nonzero — that would pass while the real defect survives.
- Cover the GREEN path too: a runnable environment must still produce the attested expected-fail row exactly as before. A fix that turns every falsifier run into inconclusive also satisfies a one-sided test.
- Scoped oracle only: `bun run test:changed $(git merge-base main HEAD)`. Do NOT run the full suite.
- After the implementation lands, declare AC-FR-11's own falsifier with `lore ac set spec-falsifiability-reachability-a-feedable-checkpoint-an AC-FR-11 --falsifier-path/-find/-replace/-exit-code`, pointing at YOUR green-control call so removing it reddens the AC. This demotes the spec to draft — that is expected; the orchestrator re-approves after merge.
