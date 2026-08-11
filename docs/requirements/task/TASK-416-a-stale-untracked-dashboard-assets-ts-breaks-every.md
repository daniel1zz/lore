---
id: TASK-416
type: task
role: plan
title: "A stale untracked dashboard-assets.ts breaks every subsequent build with an error naming neither the cause nor the remedy"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Defect

`bun run build` fails with an error that names neither the cause nor the remedy, whenever
the untracked generated file `packages/lore/src/generated/dashboard-assets.ts` is left
referencing dashboard asset filenames from an EARLIER build.

Measured 2026-08-01 on a clean working tree at `main`:

```
14 | import asset_0 from "../../../dashboard/dist/assets/index-BpctGhgh.js" with { type: "file" };
error: Could not resolve: "../../../dashboard/dist/assets/index-BpctGhgh.js"
    at packages/lore/src/generated/dashboard-assets.ts:14:21
error: script "build" exited with code 1
```

while `packages/dashboard/dist/assets/` actually contained `index-CraN1mKY.js`. Vite emits
content-hashed filenames, so any build whose asset-manifest generation does not re-run
against the CURRENT `dist/` leaves a stale import that resolves to a file that no longer
exists.

`git status` was clean and the file is untracked, so `git stash` / `git checkout` /
re-cloning do not clear it and nothing in the repo state hints that it is the problem.

Recovery, once diagnosed: `rm -f packages/lore/src/generated/dashboard-assets.ts && rm -rf
packages/dashboard/dist && bun run build` → exit 0.

## How the inconsistent state is reached

Observed in this session: a first `bun run build` failed in the dashboard `prebuild` step
(a `bunx @tanstack/router-cli@latest` invocation whose downloaded `zod` copy was
incomplete — `Cannot find module './checks.cjs'`). The dashboard `build` step had ALREADY
run and emitted a fresh hash by then, but the overall command aborted, so the generated
manifest was never regenerated to match. Every subsequent build then failed on the stale
import — including after the original prebuild fault cleared, which is what makes it
confusing: the error moves, and the second error has nothing to do with the first.

Any interrupted or concurrently-running build reaches the same state; the prebuild fault
is one entry point, not the cause.

## Requirement

1. The build FAILS LOUD with a diagnosis: when a generated asset import cannot resolve,
   say that `dashboard-assets.ts` is stale relative to `packages/dashboard/dist/`, and name
   the exact recovery command. ⛔ A raw bundler `Could not resolve` does not tell a
   caller — human or agent — that a generated file is the problem and that deleting it is
   safe.
2. Better: make the state unreachable. Regenerate the manifest from the actual `dist/`
   contents as a build step that cannot be skipped when `dist/` changes, or delete the
   generated file at the start of every build. Decide between "cannot happen" and "fails
   legibly" explicitly — do not ship both half-done.
3. ⛔ Do NOT pin or vendor the `@tanstack/router-cli` prebuild dependency as the fix. That
   addresses one way in, and the stale-manifest trap remains for every other interruption.

## Oracle

- With a deliberately stale `dashboard-assets.ts` (referencing a hash absent from `dist/`),
  `bun run build` either succeeds by regenerating, or exits non-zero with a message naming
  the generated file AND the recovery command. Assert on the filename substring, not on a
  phrase of the bundler's own error.
- CONTROL, so the assertion is not vacuous: a normal build from a clean state still exits 0
  and produces a `dist/lore` whose mtime is newer than the run's start.
- REGRESSION: the resulting binary still serves the dashboard — the packaged single-process
  topology must not be broken by whatever regeneration is added. Exercise the embedded
  assets, not just the build's exit code.
- BOUNDARY: an interrupted build (kill it mid-way, e.g. after the dashboard build step)
  leaves a state from which the NEXT build succeeds without manual `rm`. This is the case
  that actually occurred; a test that only pre-seeds a stale file does not reproduce how it
  arises.
