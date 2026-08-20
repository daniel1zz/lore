---
id: TASK-733
type: task
role: plan
title: "Make tree-scan scopes additive instead of pre-emptive, and pin the marker literals in the two real guard files"
status: draft
priority: critical
phase: "additivity"
created: 2026-08-19
updated: 2026-08-20
tags: []
parent: PLAN-130
plan: PLAN-130
---
Implements AC-TC-5 of spec-two-runner-changed-test-selection-deterministic-test.

Fixes a regression introduced by this plan's own first task. `lore assess` raised it and
the orchestrator machine-confirmed it with a direct probe before dispatching.

## The regression

`classifyTreeScanningOracle` in `scripts/changed-tests.ts` now reads:

```ts
if (!isTestFile(path)) return undefined;
if (HOOK_OR_ASSET_PAIR_MARKER_RE.test(content)) return "hooks-and-assets-pair";   // <-- pre-empts
if (!BARE_MAIN_INVOCATION_RE.test(content)) return undefined;
return REPO_TRACKED_TEXT_SOURCE_MARKER_RE.test(content) ? "repo-tracked-text-source" : "packages-test-tree";
```

The new check returns FIRST, so any test that also qualifies under an older scope loses it.
Measured 2026-08-19, six real files, scope BEFORE -> AFTER:

| file | before | after |
|---|---|---|
| `packages/lore/tests/unit/assets/pre-push-parity.test.ts` | repo-tracked-text-source | hooks-and-assets-pair |
| `scripts/tests/check-no-nul-bytes.test.ts` | repo-tracked-text-source | hooks-and-assets-pair |
| `scripts/tests/check-ac-ref-integrity.test.ts` | packages-test-tree | hooks-and-assets-pair |
| `scripts/tests/check-gap-namespace.test.ts` | packages-test-tree | hooks-and-assets-pair |
| `scripts/tests/check-no-timer-retry.test.ts` | packages-test-tree | hooks-and-assets-pair |
| `scripts/tests/check-ordinal-write-sites.test.ts` | packages-test-tree | hooks-and-assets-pair |

All six now select NOTHING for a `README.md` or `packages/core/src/errors.ts` change. These
are repo-invariant guards that used to run for exactly those changes. The first task closed
one under-selection hole and opened a wider one.

## Fix

A test may belong to MORE THAN ONE scope. Classification returns a SET; selection fires if
ANY member matches. The six files above must retain their prior scope AND gain the
hook/asset one.

## Second requirement, same acceptance unit

AC-TC-4's suite writes its own stand-in contents at the guard paths inside a temp repo, so
it proves marker recognition in FIXTURE text only. It never asserts the two REAL guard
files contain the literals the marker matches. Reformat a real guard file and production
selection silently reverts to the false green — while every fixture case stays green. Add a
case that pins the literals in the real files.
