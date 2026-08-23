---
id: KN-510
type: knowledge
role: knowledge
title: "Ten measured gaps from landing plan A wave 1 — and the one that deadlocked the whole plan shape"
status: approved
priority: medium
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PRD-001
links:
  - {id: SPEC-143, type: informs}
  - {id: PLAN-137, type: informs}
---
# Ten measured gaps from landing plan A's wave 1 — and the one that deadlocked the whole plan shape

All ten measured 2026-08-23 while dispatching three RED test tasks and merging them. Nine were found by the three implementer agents or by `lore review`; ⛔ my own self-check found ONE (the wrong anchor path), and only because I went looking for a different thing.

## 1. `lore done` has THREE conjunctive floors and only two have escape hatches — a RED-only task can NEVER archive

`packages/lore/src/service/task-workflow-service.ts` — floor 1 attestation (escape: `--override-attestation`), floor 2 red-first (escape: `--declare-no-new-tests`), floor 3 `findMissingUnfilteredTestFileRuns` at :2934 (**NO escape**). Floor 3 demands, for EACH declared `.test.ts` anchor, an `oracle:test result:pass` row running that file UNFILTERED. A task whose declared anchor IS the failing test file therefore cannot archive, and any task that `blocks` on its archival is deadlocked with it.

⛔ Floor 3 is NOT the defect — it exists to stop a `-t`-filtered pass certifying a whole file, which is sound. The defect is pairing an ARCHIVAL UNIT with an anchor it cannot turn green. Measured cost: plan A's entire 15-task shape (7 RED/impl pairs joined by `blocks`) was a deadlock, and it was discovered only when the FIRST red task came back and `lore done` refused it twice in a row.

⛔ **The remediation hint is actively misleading.** Floor 1's refusal names `--override-attestation` as "the audited escape hatch" with no hint that floor 3 will refuse the very next attempt. A user who takes the printed command at face value learns the truth one refusal later. A refusal that names a repair should name the NEXT floor too, or say it cannot see past itself.

Fix applied: collapse each pair into one task taking two sequential claims by two different agents (plan A D-A8). Zero overrides on 6 of 7 pairs.

## 2. The collapse traded a MECHANICAL guarantee for CONVENTION — and nothing refuses the violation

Raised by `lore review` on the edited plan, correctly. Before the collapse, "the agent that records the red is not the agent that turns it green" was structural: two docs, two leases, a `blocks` edge. After it, ONE task takes two claims and **no gate compares `recorded_by` on the red row against `recorded_by` on the attesting pass**. INV-4's independence is now dispatch discipline, which this project counts as NOT ENFORCED.

The missing mechanism is a PREDICATE, not a measurement: every evidence row already carries `recorded_by`. A `lore done` floor asserting "at least one red row's actor differs from every attesting pass row's actor" is computable today.

## 3. `lore evidence --ac` SILENTLY DROPS the reference when passed twice

`evidence.ts:361` declares `--ac` as `type: "string"`; the write at `:636` is guarded by `typeof args.ac === "string"`. Two `--ac` flags make citty produce an **array**, the guard is false, `ac_ref` is dropped **entirely — exit 0, no warning**. Measured artifact: one evidence row in the append-only log with no `ac_ref` despite the flag being passed.

⛔ This is the exact defect class SPEC-143 exists to close: a write that LOOKS compliant and leaves "which ACs have an observed-red falsifier" unqueryable corpus-wide. One row can carry at most one AC; two ACs need two rows. ⛔ A dispatch bundle mandating `--ac A --ac B` (mine did) is unsatisfiable as written.

## 4. `packages/core/tests/**` is typechecked by NOTHING

`bun run typecheck` runs seven projects; there is no `typecheck:core-tests`, and `packages/core/tsconfig.json` is `include: ["src/**/*"], exclude: ["tests"]`. Any `@ts-expect-error` or type-level assertion under `packages/core/tests/` is therefore a **false oracle** — it can never fail. Affects the existing files there, not just new ones.

## 5. A worktree runtime import of `@lore/core` measures MAIN's source, not the worktree's

A fresh worktree has no `node_modules`, so `@lore/core` resolves UPWARD to `<main>/node_modules/@lore/core` → `<main>/packages/core`. Measured directly: with a CORRECT reference implementation applied inside the worktree, the `@lore/core` runtime read still reported a symbol missing while fifteen other cases were green.

⛔ Here it failed SAFE (false red). The reverse fails UNSAFE: a symbol deleted in the worktree still reads as present from main, so a worktree "green control" over `@lore/core` can certify MAIN's code while claiming to test the branch. Affects every worktree agent. Same family as `knowledge-a-symlinked-node-modules-makes-the-green-control-pass`, different mechanism (upward resolution rather than a symlink).

Corollary: there is currently NO in-repo way for a `packages/lore/tests` file to runtime-import this checkout's core barrel. The obvious relative path is TS6059 because `packages/lore/tsconfig.tests.json` sets `rootDir: "."`, and it cascades across the whole `packages/core` graph.

## 6. `mirror-human-id-brand.bun.test.ts` is structurally broken in every worktree, and one of its cases passes VACUOUSLY

It computes `TSC_BIN` as `REPO_ROOT/node_modules/.bin/tsc` with `REPO_ROOT` five levels up from the test file — a path that does not exist in a worktree. Measured in one: **3 fail, 1 pass, `status: undefined`** (the spawn never happened). The one "pass" is the ERROR case asserting `expect(output).not.toContain(BRAND_TYPE_NAME)` — green precisely BECAUSE there was no output at all.

⛔ An assert-absence oracle is green when nothing ran. This is the V8 lesson (`a harness that started is not a harness that sees the copy it runs`) with a new face: the harness did not even start, and the suite still reported a pass. Fix: resolve the tool by an upward walk that THROWS a named error rather than yielding a `null` status.

## 7. Task `file_anchors` are NOT drift-checked

`task-skill-implement-evidence-capture-writes-a-real-attestation` declared `packages/lore/src/adapters/cli/evidence-capture.ts` — a path that does not exist; the real file is `packages/lore/src/adapters/evidence-capture.ts` (no `cli/` segment). `lore status --check-drift` exits 0 with the wrong path present (it checks spec/knowledge `code_anchors`, 93 specs + 0 knowledge docs). An implementer following that anchor would have created a SECOND file in the wrong directory, and the anchor mutex would have been guarding a path nobody touches.

⛔ `lore anchor add` DOES print a `file_anchors advisory — N declared anchor(s) do NOT resolve` line, so the capability exists at write time and is simply absent from the standing check.

## 8. The scratchpad directory is SHARED between concurrent agents, not per-agent

A peer agent overwrote `<scratchpad>/commitmsg.txt` with a different task's commit message mid-task. No damage that time. `git commit -F <shared-path>` racing a peer would silently commit the PEER'S message — and the merge-message-must-contain-the-task-slug rule would then be satisfied by the wrong slug.

## 9. A guard whose check surface is the inline command string, not what will execute

Reported by an implementer: `export X=… && lore claim …` and multi-line probes were refused as "too complex to verify", but writing the identical content to a script file and running `bash <path>` passed unchecked. ⛔ Per this project's own rule (extra work to get past a gate = the gate has a hole), the action of working around it IS the report trigger. The bypass is open to any agent.

## 10. SPEC-143's C1/C2 type foundation carries NO acceptance criterion

The plan's own Risk Register calls it "a single point of failure — six consumers depend on it". It is the ONE item in the plan with no AC, so its task's `ac_scope` is legitimately empty, `lore verify` has nothing to bind to, and no attested pass is reachable — the single highest-risk item is the only one that cannot be attested. Recorded as plan A D-A9.
