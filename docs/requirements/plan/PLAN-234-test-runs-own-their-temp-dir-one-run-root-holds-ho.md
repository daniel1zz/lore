---
id: PLAN-234
type: plan
role: plan
title: "Test runs own their temp dir: one run root holds HOME and TMPDIR, removed by its run"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: SPEC-204
phases:
  - {name: "P1"}
---
## Overview

Test runs leave every temp directory they create in the user temp dir. On 2026-10-19 it held ~22,800 `lore-*` directories (~5 GB; 5,473 from the last day) plus `turn-state*` (3,269) and `turn-repo*` (3,066), and the disk reached 391 MB free (the dashboard API then returned 500s). Governing spec: spec-process-state-end-state-one-invocation-per-entry-returned Goal 5 (the test process runs with a throwaway HOME); this plan completes that goal for the temp dir.

Cause (read from code): the tests call `mkdtemp(join(tmpdir(), "<prefix>"))` and never remove the directory — e.g. `packages/lore/tests/unit/core/global-config.test.ts:72` (afterEach only restores env), `auth-routes.bun.test.ts:88` (path not even kept), the `*-machine-auth` dirs in `phase-status.bun.test.ts:78`, `telemetry-route.bun.test.ts:90`, `http-record-lock.bun.test.ts:94`, and the hook harnesses `hook-harness.ts:39` / `turn-review-harness.ts:26`. `vitest.shared.ts` `armThrowawayHome` (:35-48) already creates a throwaway HOME at config load and removes it on process exit, but nothing sets TMPDIR, so `tmpdir()` is the real user temp dir. Both vitest invocations (`scripts/run-tests.ts:51-55`: Bun-runtime and Node) load `vitest.shared.ts`; there is no separate `bun test` runner any more.

## Design

- D1 One owner per run. At config load (before workers fork, so workers, compiled `dist/lore` children and hook `node` children inherit it), `vitest.shared.ts` creates one run root `realpath(<original tmpdir>)/lore-test-runs/<pid>-<random>/` holding `home/` and `tmp/`, and sets `HOME=<root>/home` and `TMPDIR`/`TMP`/`TEMP=<root>/tmp`. A nested run (a test that runs vitest) reuses its parent's root via the existing `LORE_TEST_THROWAWAY_HOME` marker. Tests keep calling `mkdtemp(tmpdir())` unchanged; no per-test cleanup is required.
- D2 The run removes its root on exit (the existing `process.once("exit")` handler, now removing the whole root; vitest routes SIGINT/SIGTERM through `process.exit`).
- D3 A run killed with SIGKILL cannot run D2, so its root outlives its owner. Ownership is by liveness: the root's name carries its run's pid, and a run starting up removes every root under `lore-test-runs/` whose pid is not alive (`process.kill(pid, 0)` → ESRCH). This is the same ownership rule as D2 applied to an owner that is gone, not an age-based sweep: a live run's root is never touched.
- Not chosen: adding `rm` to each of the dozens of tests (repeats the defect at every new test); a periodic age-based cleaner (deletes a slow live run's files, keeps a dead run's files until the deadline).

## Phases

- P1: one task.

## Acceptance (observable, red first)

- Count `ls "$(getconf DARWIN_USER_TEMP_DIR)" | grep -cE '^(lore-|turn-)'` (or `os.tmpdir()` on other platforms) before and after running a representative vitest selection under both runtimes (Bun-runtime vitest and Node vitest) that includes global-config.test.ts, auth-routes.bun.test.ts and a hook-harness test: the count is unchanged, and `lore-test-runs/` is empty afterwards.
- A run killed with SIGKILL leaves its root; the next run's completion leaves `lore-test-runs/` empty, and a root whose pid is alive (a concurrently running run) is not removed.
