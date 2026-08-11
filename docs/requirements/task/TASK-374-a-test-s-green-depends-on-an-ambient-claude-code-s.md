---
id: TASK-374
type: task
role: plan
title: "A test's green depends on an ambient CLAUDE_CODE_SESSION_ID, so every full-suite verdict on this machine is machine-conditional"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: ADR-029, type: relates-to}
---
# Defect — a test's green depends on an ambient env var, so the full suite is machine-conditional

Found by `agent:fix-phase-claim-session-id` while closing
`task-phaseworkflowservice-claim-captures-no-session-id-so-every`, and **independently
reproduced by the orchestrator on `main @ f3d120b`** (exit codes measured without a pipe):

| run | result |
|---|---|
| `bun test --timeout 30000 tests/integration/gate-p2-cross-tier.bun.test.ts` | 22 pass / 0 fail, exit **0** |
| the same, `env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID` | 21 pass / **1 fail**, exit **1** |

The failing case, verbatim from the runner:

```
(fail) lore gate task-claim — AC-P2-ANCHOR: anchor-overlap parity with `lore claim`
  (SPEC-042 D5) > REGRESSION: a fresh claim by the SAME actor does not conflict,
  even with overlapping anchors
Expected: 0
Received: 4
```

`packages/lore/tests/integration/gate-p2-cross-tier.bun.test.ts:820`. Both the claim it makes
and the `lore gate task-claim` call it then checks read the ambient environment, so the
`session_id` they capture comes from whatever `CLAUDE_CODE_SESSION_ID` the shell happens to
carry. With the variable present both sides capture the SAME id and `noAnchorOverlap` exempts
the sibling (exit 0). With it absent both capture NOTHING, and the fail-safe correctly refuses
with `ANCHOR_OVERLAP_SESSION_UNMEASURED` (exit 4) — the test asserts 0 and fails.

⛔ The production behaviour is CORRECT in both cases. Nothing is broken in `lore`. The defect is
in the ORACLE: it asserts a value that only holds under an undeclared precondition.

# Mechanism root — an undeclared ambient precondition reads as a property of the code

This is the false-oracle family's ambient-state vector: the suite is green on the author's
machine and red anywhere the variable is unset, and NOTHING in the test declares the
dependency. It was introduced by `task-two-concurrent-orchestrators-both-resolve-to-agent-main`
(the task that added `session_id` capture on the task channel) — before that change no claim
read the environment, so the test's assertion was environment-independent when written. The
capture change silently converted a deterministic oracle into a machine-conditional one.

Two mechanisms in this repo already do the right thing and are the models to copy:

- `packages/lore/tests/unit/service/phase-claim-session-capture.test.ts` injects the env
  explicitly — no ambient read at all.
- `packages/lore/tests/integration/claim-session-capture-app-wiring.bun.test.ts` saves,
  deletes and restores the variable per case.

Both were verified immune: re-run under `env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID`
they exit 0 (25 vitest tests, 9 bun tests).

## Blast radius beyond this one case

⛔ **Every "full suite green" verdict recorded on this machine is conditional on that variable.**
This session's authoritative baselines (`TEST_EXIT=0` at `a29e006`, vitest 453 files / 8048
passed, bun 1767 pass / 0 fail) were all measured with `CLAUDE_CODE_SESSION_ID` SET. The same
commit in a CI container without it is red. The repo has no CI today (`.github/` does not
exist), which is exactly why nothing has caught this.

# Required fix

1. Make the case environment-independent by CONSTRUCTION, not by setting the variable:
   inject the session id (as `phase-claim-session-capture.test.ts` does) or save/delete/restore
   it per case (as `claim-session-capture-app-wiring.bun.test.ts` does). ⛔ Do NOT "fix" this by
   exporting the variable in a test setup file or a runner config — that hides the dependency
   one layer up and leaves the next ambient-state oracle undetected.
2. Assert BOTH branches explicitly in that file: same-captured-session → exempt (exit 0), and
   absent-session → `ANCHOR_OVERLAP_SESSION_UNMEASURED` refusal (exit 4). Today only the first
   is asserted, which is why the fail-safe branch reads as a failure rather than as a case.
3. Sweep for siblings: any other test that reads `CLAUDE_CODE_SESSION_ID` / `CLAUDE_SESSION_ID`
   ambiently, or reaches a claim/gate path that does. Report the set; the sweep result IS this
   task's scope. ⛔ Do not assume this is the only one — that assumption is what produced the
   nine-then-eleven plan-member sites.

# Proxy / Silence / Opt-in

**Proxy.** "The suite exits 0" is a proxy for "the asserted behaviour holds". Concrete input
satisfying the proxy while violating the property: this very case on this very machine. The fix
removes the proxy by making the precondition explicit rather than ambient.

**Silence.** Total today: the pass is indistinguishable from a correctness pass, and the
failure appears only on a machine nobody runs. That is why it survived.

**Opt-in.** None — the ambient read is unconditional. After the fix the env is injected, so
there is nothing to opt into.

# Oracle

- RED first: `env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID bun test <file>` exits 1 today.
  After the fix it exits 0. ⛔ Assert BOTH the stripped-env and the ambient-env run — a fix that
  only works when the variable is absent is the same defect mirrored.
- CONTROL: with the variable SET the file still exits 0 and the pass count is unchanged (22).
- CONTROL: the two model files above stay byte-unchanged and green under both environments.
- CONTROL: the sweep from fix item 3 finds zero remaining ambient readers, and that zero is
  reported as a positive count of files scanned — never a bare "no matches".
- Measure every exit code WITHOUT a pipe (`cmd > out 2>&1; echo $?`).

Distribution surface: this repo's own test tree. The production code is correct and must not
change — ⛔ any diff under `packages/lore/src` or `packages/core/src` in this task is a signal
that the oracle was "fixed" by moving the goalposts.
