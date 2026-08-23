---
id: KN-507
type: knowledge
role: knowledge
title: "Five gaps from landing plan A's type foundation — two same-batch worktrees on a stale base, a compile oracle green under its own falsifier, and a shipped arming constant that never arms downstream"
status: approved
priority: high
created: 2026-08-23
updated: 2026-08-23
tags: [worktree-base, oracle-precision, test-changed, monorepo-typecheck, arming-rev, spec-143]
parent: PRD-001
links:
  - {id: KN-510, type: relates-to}
  - {id: SPEC-143, type: informs}
---
Measured 2026-08-23 by `agent:main-orchestrator` and `agent:ct-t0-green-types` while landing the GREEN stage of `task-skill-test-two-axis-type-foundation-red-test-scenarios` (plan A T0, SPEC-143 C1+C2, merged as `61509513`). Five findings. Three of them contradict or under-state a standing rule, which is the reason this is a separate doc rather than a line in a report.

## 1. The harness gave three same-batch worktrees TWO DIFFERENT base commits, and one of them lacked its own RED oracle

Dispatched in ONE message, main at `b7f1222d`:

| worktree | base HEAD | consequence |
|---|---|---|
| `agent-aee1dfb925aee39e4` (T2) | `b7f1222d` — correct | fine |
| `agent-acb0585fea0364051` (T1) | `29506b5a` — 2 behind | benign by luck: T1's RED landed BEFORE that commit |
| `agent-a66d2c749ef7e945a` (T0) | `29506b5a` — 2 behind | **its own RED tests were absent** — they land in `474ed909` |

The T0 agent detected this itself and ran `git merge main --ff-only` before starting. Nothing in the dispatch protocol asked it to check, and nothing would have refused a GREEN agent that instead concluded "the RED test does not exist, I will write it" — which produces an agent authoring the oracle it then satisfies, the precise failure the two-claim structure of plan A D-A3/D-A10 exists to prevent.

The standing rule says a dispatch must `git pull --rebase origin main` first BECAUSE "the harness builds worktrees off the current HEAD and does not pull". The premise is false: the pull was unnecessary here (`origin/main` was an ancestor of `main`) and the worktree was STILL two commits stale. Pulling does not fix an unknown base.

**Mechanism it needs**: the dispatch bundle should state the expected base SHA, and the agent should assert `git merge-base --is-ancestor <expected> HEAD` before its first read. That is a two-line precondition an agent cannot forget, versus a premise that was simply wrong.

## 2. A compile-fixture oracle stayed GREEN while measuring nothing, under the very falsifier meant to prove it

T0's `BOUNDARY (compile)` case asserts that a `tsc` run over a fixture emits output containing the substrings `changed` and `RadiusMeasurement`. Under falsifier F1 — `RadiusMeasurement` weakened back to the retired `boolean | "unmeasured"` — the case stayed green. Reason: the weakened type produces COLLATERAL errors inside the real module, and those errors also contain both words. The assertion cannot tell "the fixture failed to compile for the declared reason" from "something else nearby failed and happened to mention the same identifiers".

The implementer correctly did NOT touch it: editing an oracle after seeing it red is a spec change requiring explicit re-baseline. Recorded here instead.

This is the substring-matcher lesson with a new polarity. The known form is OVER-MATCHING a self-documenting corpus. This form is matching the RIGHT strings from the WRONG SOURCE. Anchoring structurally is not enough either — the fix is to assert the diagnostic's FILE and CODE (e.g. the fixture path plus `TS2322`), not free text anywhere in the output.

## 3. `bun run test:changed` OVER-selects on a high-fan-in file, and the standing note only warns that it UNDER-selects

Changing `packages/core/src/task-workflow.ts` made it select **623 files** (417 vitest + 206 bun, `build-first: yes`, 98 binary-consumers) — the full suite in all but name. A worktree agent is forbidden from running the full suite (N parallel full suites starve spawn-based tests into false 30s timeouts), so on this class of edit the "deterministic worktree oracle" is not merely imprecise, it is UNUSABLE, and the agent must hand-pick direct consumers.

The root CLAUDE.md note lists three under-selection blind spots and no over-selection mode at all, so a reader plans for gaps and is surprised by a 623-file selection. Both failure directions belong in the same sentence, and the honest consequence is that a full-suite verdict on `main` after merge is MANDATORY for high-fan-in edits, not a nice-to-have. The T0 agent said so explicitly in its return.

## 4. `bun run build` cannot fix worktree cross-package typechecking for `@lore/core`, so the standing "build the sub-package first" rule does not apply to it

A worktree has no `node_modules`, so `@lore/core` resolves through the MAIN checkout's `packages/core`. A worktree agent that adds a core export AND consumes it from `packages/lore` therefore typechecks against MAIN's core and gets a FALSE GREEN.

The standing remedy — "build the sub-package (tsup) before validating a consumer" — is INAPPLICABLE here: `@lore/core` maps to `./src/index.ts`, so there is no `dist` for a build to refresh. The known form of this gap was recorded as a runtime import measuring main's source; the compile-time half, and the fact that the documented fix is a no-op for this package, are new.

**Consequence for dispatch**: a task that adds a `@lore/core` export and a consumer of it in the same change CANNOT be verified inside one worktree. Either split it across two tasks, or the main agent must re-verify on the merged tree — and must do so knowing the agent's own green was structurally uninformative.

## 5. `ARMING_REV` as a shipped literal never arms in any consumer corpus

SPEC-143 §159 chooses deliberately: `arming_rev` "is data, not a computation — nothing re-derives it". The implementation followed the spec exactly, measuring `MAX(audit.id)` in the declaring commit (14992; the spec's own `6176` at §135 is a 2026-08-17 measurement, not a prescribed value, and was 2.4x stale).

Two consequences the spec does not address:

- **Distribution**: the constant ships inside the binary. In any consumer corpus every existing row sits BELOW 14992, so everything classifies `legacy_unbound`, which every floor accepts — the floor never arms downstream. The mechanism is inert for exactly the audience the project's distribution-first rule exists to protect.
- **Re-capture**: the declaring commit (C1/C2) is NOT the arming commit (AC-CT-3, where a floor first consumes it). Every audit row written between the two would be retro-classified `unbound`, the mass-wedge N2 and G5 both forbid. The implementer wrote this duty into the constant's JSDoc and labelled it, correctly, as unenforced prose.

Neither is an implementation defect — both are spec-level, and fixing them means changing what `arming_rev` IS (a per-corpus value resolved at install/init, or a value written to corpus config at arming time). That belongs in a SPEC-143 revision or its own ADR, not in a task.
