---
id: KN-346
type: knowledge
role: knowledge
title: "A RED test's redness proves absence of behaviour, not correctness of the assertion — 3 of 9 tasks were RED-test repairs"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: [dogfood, red-green, test-quality, verify-env, hermetic-tests]
parent: PLAN-105
---
# A RED test's redness proves the behaviour is absent — it does NOT prove the assertion is correct

## The measurement

`plan-implementation-out-of-box-reporting-channel-self-provision` was planned as 6 tasks and closed as 9. The three added tasks were **not** scope change. All three existed solely to repair defects in the RED tests themselves:

| Added task | Defect in the RED test | Detected |
|---|---|---|
| T7 | T2's new assertion logically contradicted a pre-existing baseline sub-case — same command, same setup, opposite expected stderr | GREEN, when no implementation could satisfy both |
| T8 | T1 compared a written path against the raw `mkdtempSync` string, but the resolver realpath-resolves (macOS `/var` → `/private/var`) | GREEN, 3 failures differing only by a `/private` prefix |
| T9 | T1 and T2 both left `LORE_ACTOR` unset in spawned subprocesses, so the SPEC-035 actor advisory added a second stderr line and broke exact-line-count assertions | Only under `lore verify`; passed by hand |

Three independent defect classes, all in tests that had been **observed RED for the intended reason** and merged on that basis.

## The generalizable lesson

Red-before-green verifies exactly one proposition: *the behaviour does not exist yet*. It is silent on whether the assertion encodes the behaviour you actually want. **A test with a wrong assertion is red in a way that is bit-for-bit indistinguishable from a test with a right assertion.** The RED phase's own discipline ("confirm it fails for the intended reason, not a typo") catches import errors and typos — it does not catch a semantically wrong expectation, because a semantically wrong expectation also fails "for the intended reason": the behaviour is genuinely absent.

The asymmetry that makes this expensive: a wrong RED assertion is discovered only at GREEN, by which time an implementer is already mid-task and must either stop and escalate (correct, what T5 did) or quietly bend the test to pass (silent corruption of the oracle). The cost lands on the wrong task.

**What actually catches these** — every one of the three was caught by a check that is available at RED time:

1. **Contradiction sweep**: before merging a RED test, search the same file and its siblings for assertions over the SAME command/scenario. T7's contradiction was two `it` blocks in one file running an identical command with opposite expectations — statically detectable, no implementation needed.
2. **Environment-parity run**: run the new RED test under the environment the CI/attesting runner actually uses, not just the author's shell. T9's defect was invisible by hand and deterministic under `lore verify`'s 12-variable allowlist. **Passing by hand is not passing.**
3. **Cross-suite expectation diff**: when a sibling suite already asserts against the same production function, compare how it phrases the expectation. T8's raw-vs-realpath bug was already answered correctly in `report-issue-wiring-provision.bun.test.ts`, with an explanatory comment, before T8's file was written.

None of these require the implementation to exist. They are RED-phase checks that were simply never run.

## Environment-sensitive assertions — the specific hazard class

`lore verify` spawns AC commands through `DEFAULT_VERIFY_ENV_ALLOWLIST` (`packages/lore/src/service/verify-spawn.ts`): exactly `PATH HOME USER LOGNAME SHELL LANG TZ TMPDIR TEMP TMP TERM PWD`. Not `LORE_ACTOR`, not `CLAUDECODE`, not `CI`.

Consequence: any spawned `lore` command that touches the corpus emits the SPEC-035 actor OS-fallback advisory to stderr. Any assertion of the form "stderr is exactly N lines" or "stderr is byte-empty" therefore **passes by hand and fails under attestation**.

The correct fix is in the TEST, not the allowlist: a test must control its own environment (`LORE_ACTOR` pinned in the spawn env). Widening the allowlist only masks it — a caller who genuinely has no `LORE_ACTOR` set still trips it. This is the same principle as "never let a test read ambient build artifacts without controlling them".

A sweep over `packages/lore/tests/` (T9) found the fixed file was the only spawn-based one with exact-line-count assertions. But it also found a **different, lower-visibility variant**: `cli-create.bun.test.ts:218,237,289,1273,1311` and `cli-editor-integration.bun.test.ts:184,220,366` assert `stderr.toHaveLength(0)` on IN-PROCESS `run()` calls without managing actor identity. Because the advisory dedupes once per process, whichever of these runs first sees the warning and the rest do not — **order-dependent flakiness**, not a deterministic break. Untriaged; a shared hermetic-spawn helper that always pins `LORE_ACTOR` would close the whole class.

## Two further findings from the same run

**Evidence is append-only with no correction path.** T4 recorded three throwaway probe entries with commands literally `"x"`, `"x3"`, `"x4"`, all `result=pass`, while debugging shell quoting. It disclosed them honestly, but they cannot be removed. The plan's own assessment independently flagged them and recommended "purge the three existing ones" — an action the tool does not support. They carry no `--ac` tag so coverage counts are unaffected, but an auditor cannot distinguish them from real oracle runs except by reading the command text. Recording an unrunnable string as a passing oracle should be rejected at write time.

**A nested subagent's Stop hook committed its parent's in-flight work.** T9 dispatched a read-only Explore subagent for the sweep; that child ran in the SAME worktree, and at its termination `subagent-stop-commit-guard.mjs` found T9's applied-but-uncommitted edit and committed it under the default git identity. T9 diffed the result against its intent (byte-identical) before proceeding, which is the right recovery. Note the direction: CLAUDE.md already records the opposite failure (a live background child letting the guard MISS a commit). This is the inverse — a child's guard committing work that was never its own, at a moment its actual author did not choose, attributed to neither agent. The guard decides from working-tree state; it has no notion of which agent owns the change.

## Method note

The three RED defects were each confirmed by direct reproduction before being accepted, not taken on the reporting agent's word — including one case where a subagent's "8 pass" and the orchestrator's own run disagreed (cause: a stale `dist/lore`; the suite's `assertFreshBinary` guard correctly refused to run rather than reporting a false green).
