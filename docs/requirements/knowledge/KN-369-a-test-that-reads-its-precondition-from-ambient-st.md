---
id: KN-369
type: knowledge
role: knowledge
title: "A test that reads its precondition from ambient state is a false oracle in both directions"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: [testing, false-oracle, f5a]
parent: SPEC-105
links:
  - {id: SPEC-105, type: informs}
---
# A test that reads its precondition from ambient state is a false oracle in both directions

## Case

F5a's "source-run guard" case asserted that packaged-mode `lore dashboard` exits non-zero when NO built dashboard assets exist. It never established that precondition — it inherited whatever the checkout happened to have.

- In the implementer's worktree (no build yet, or the generated module manually deleted) → the guard branch ran → test passed.
- On main after any `bun run build` → `packages/lore/src/generated/dashboard-assets.ts` existed → the CLI correctly started and exited 0 → `expect(exitCode).not.toBe(0)` failed.

Same commit, opposite verdicts, decided entirely by ambient build state. It had been recorded as passing evidence from the worktree run.

## Fix

An explicit force-unavailable seam (`LORE_DASHBOARD_ASSETS_FIXTURE=0`) short-circuits asset resolution BEFORE the real loader touches the filesystem, so the guard branch is exercised deterministically. The seam matches the exact string `"0"` only; a real user's launch never sets it.

⛔ Rejected: deleting/moving the generated artifact from inside the test. Mutating a shared build artifact is order-dependent and corrupts concurrently running suites.

## Acceptance rule that caught it

The fix task's AC required running the test in BOTH environments (artifact present AND absent) and recording BOTH exit codes. **A test that passes in only one environment has not been fixed** — and if only the convenient environment is ever run, the defect is invisible.

## Residual trade-off (recorded, not hidden)

Forcing the precondition means this case no longer exercises the production availability check — a regression in the real loader's unavailable branch would not be caught here. That coverage belongs to a separate test that drives the real loader against a genuinely absent module. Flagged by `lore assess` as an outcome-dimension minor.

## Generalization

Before trusting a green test, ask what state it READS but does not SET. Anything in that set — build artifacts, env vars, ports, corpus contents, installed assets — is an uncontrolled input, and the test's verdict is a statement about the machine, not about the code.
